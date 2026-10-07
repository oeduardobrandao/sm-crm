import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaOcorrencia } from '../../../../store/agenda';
import { descreverRegra, emFuso } from '../agendaLogic';
import { EventoPopover } from '../EventoPopover';

const {
  responderEventoMock,
  excluirEventoMock,
  resolverRemarcacaoMock,
  getWorkspaceUsersMock,
  toastMock,
  toastSuccessMock,
  toastErrorMock,
  baixarIcsMock,
  linkGoogleMock,
} = vi.hoisted(() => ({
  responderEventoMock: vi.fn(),
  excluirEventoMock: vi.fn(),
  resolverRemarcacaoMock: vi.fn(),
  getWorkspaceUsersMock: vi.fn(),
  toastMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  baixarIcsMock: vi.fn(),
  linkGoogleMock: vi.fn(),
}));

vi.mock('@/store/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/agenda')>()),
  responderEvento: responderEventoMock,
  excluirEvento: excluirEventoMock,
  resolverRemarcacao: resolverRemarcacaoMock,
}));
vi.mock('../baixarIcs', () => ({ baixarIcsDaOcorrencia: baixarIcsMock }));
vi.mock('../googleAgenda', () => ({ linkGoogleAgenda: linkGoogleMock }));
vi.mock('@/store/workspace', () => ({ getWorkspaceUsers: getWorkspaceUsersMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('sonner', () => ({
  toast: Object.assign(toastMock, { success: toastSuccessMock, error: toastErrorMock }),
}));

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const ROSTER = [
  { id: 'bruno', nome: 'Bruno Costa', avatar_url: null },
  { id: 'carla', nome: 'Carla Mendes', avatar_url: 'https://cdn.example.com/carla.png' },
  { id: 'diego', nome: 'Diego Rocha', avatar_url: null },
  { id: 'me', nome: 'Ana Lima', avatar_url: null },
];

function ocorrencia(p: Partial<AgendaOcorrencia> = {}): AgendaOcorrencia {
  return {
    ocorrencia_id: 7,
    evento_id: 3,
    data_original: '2026-10-05',
    inicio: new Date(2026, 9, 5, 14, 0).toISOString(),
    fim: new Date(2026, 9, 5, 16, 0).toISOString(),
    dia_inteiro: false,
    data_inicio_local: '2026-10-05',
    data_fim_local: '2026-10-06',
    titulo: 'Gravação: Clínica Sorriso',
    descricao: 'Gravar 4 reels da campanha de novembro.',
    local: 'Estúdio 2, Av. Paulista, 900',
    link_reuniao: 'https://meet.google.com/abc-defg-hij',
    tipo: 'gravacao',
    cor: null,
    cliente_id: 12,
    cliente_nome: 'Clínica Sorriso',
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [1440, 10],
    organizador_id: 'bruno',
    participantes: [
      { user_id: 'bruno', resposta: 'sim' },
      { user_id: 'carla', resposta: 'sim' },
      { user_id: 'diego', resposta: 'talvez' },
      { user_id: 'me', resposta: 'pendente' },
    ],
    minha_resposta: 'pendente',
    pode_editar: true,
    pode_responder: true,
    tz: TZ,
    compartilhado_cliente: false,
    cliente_resposta: null,
    remarcacao_pendente: null,
    sequencia: 0,
    ...p,
  };
}

const REGRA = {
  freq: 'weekly' as const,
  intervalo: 1,
  dias_semana: [1],
  mensal_modo: null,
  mensal_ordinal: null,
  ate: '2026-11-30',
  contagem: null,
};

let qc: QueryClient;
let anchor: HTMLElement;

function abrir(o: AgendaOcorrencia, extra: { onClose?: () => void; onEditar?: () => void } = {}) {
  const onClose = extra.onClose ?? vi.fn();
  const onEditar = extra.onEditar ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <EventoPopover ocorrencia={o} anchor={anchor} onClose={onClose} onEditar={onEditar} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onEditar };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  anchor = document.createElement('div');
  document.body.appendChild(anchor);
  responderEventoMock.mockReset().mockResolvedValue(undefined);
  excluirEventoMock.mockReset().mockResolvedValue(undefined);
  resolverRemarcacaoMock.mockReset().mockResolvedValue(undefined);
  getWorkspaceUsersMock.mockReset().mockResolvedValue(ROSTER);
  toastMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  baixarIcsMock.mockReset().mockResolvedValue(undefined);
  linkGoogleMock.mockReset().mockReturnValue('https://calendar.google.com/calendar/render?x=1');
});

afterEach(() => {
  anchor.remove();
});

describe('EventoPopover', () => {
  it('shows the event details', async () => {
    const o = ocorrencia({ recorrente: true, regra: REGRA });
    abrir(o);

    const dialog = await screen.findByRole('dialog', { name: 'Gravação: Clínica Sorriso' });
    expect(
      within(dialog).getByRole('heading', { name: 'Gravação: Clínica Sorriso' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Segunda, 5 de outubro · 14:00 a 16:00')).toBeInTheDocument();
    expect(screen.getByText(descreverRegra(REGRA, emFuso(o.inicio, TZ)))).toBeInTheDocument();
    expect(screen.getByText('Estúdio 2, Av. Paulista, 900')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Entrar na reunião' });
    expect(link).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Cliente: Clínica Sorriso')).toBeInTheDocument();
    expect(screen.getByText('10 minutos antes, 1 dia antes')).toBeInTheDocument();
    expect(screen.getByText('Gravar 4 reels da campanha de novembro.')).toBeInTheDocument();
  });

  it('lists participants with their answers and a summary line', async () => {
    abrir(ocorrencia());

    const lista = await screen.findByRole('list', { name: 'Participantes' });
    await within(lista).findByText('Bruno Costa');
    const linhas = within(lista).getAllByRole('listitem');
    expect(linhas).toHaveLength(4);
    // Organizer first, then by name.
    expect(linhas[0]).toHaveTextContent('Bruno Costa');
    expect(linhas[0]).toHaveTextContent('organizador');
    expect(within(linhas[0]).getByText('Sim')).toBeInTheDocument();
    expect(linhas[1]).toHaveTextContent('Ana Lima (você)');
    expect(within(linhas[1]).getByText('Aguardando')).toBeInTheDocument();
    expect(linhas[2]).toHaveTextContent('Carla Mendes');
    expect(within(linhas[3]).getByText('Talvez')).toBeInTheDocument();
    expect(screen.getByText('4 participantes')).toBeInTheDocument();
    expect(screen.getByText('· 2 sim, 1 aguardando, 1 talvez')).toBeInTheDocument();
  });

  it('shows a declined answer as Não', async () => {
    abrir(
      ocorrencia({
        participantes: [
          { user_id: 'bruno', resposta: 'sim' },
          { user_id: 'carla', resposta: 'nao' },
        ],
      }),
    );
    const lista = await screen.findByRole('list', { name: 'Participantes' });
    expect(within(lista).getByText('Não')).toBeInTheDocument();
    expect(screen.getByText('2 participantes')).toBeInTheDocument();
    expect(screen.getByText('· 1 sim, 1 não')).toBeInTheDocument();
  });

  it('summarizes only the non-zero answers, sim, não, aguardando, talvez', async () => {
    abrir(
      ocorrencia({
        participantes: [
          { user_id: 'bruno', resposta: 'sim' },
          { user_id: 'carla', resposta: 'sim' },
          { user_id: 'diego', resposta: 'nao' },
          { user_id: 'me', resposta: 'pendente' },
        ],
      }),
    );
    await screen.findByRole('list', { name: 'Participantes' });
    expect(screen.getByText('4 participantes')).toBeInTheDocument();
    expect(screen.getByText('· 2 sim, 1 não, 1 aguardando')).toBeInTheDocument();
  });

  it('uses the singular for a single participant', async () => {
    abrir(
      ocorrencia({
        participantes: [{ user_id: 'bruno', resposta: 'sim' }],
        pode_responder: false,
      }),
    );
    await screen.findByRole('list', { name: 'Participantes' });
    expect(screen.getByText('1 participante')).toBeInTheDocument();
    expect(screen.getByText('· 1 sim')).toBeInTheDocument();
  });

  it('falls back to a generic name for someone not in the roster', async () => {
    getWorkspaceUsersMock.mockResolvedValue([]);
    abrir(ocorrencia({ participantes: [{ user_id: 'x', resposta: 'sim' }] }));
    const lista = await screen.findByRole('list', { name: 'Participantes' });
    expect(within(lista).getByText('Pessoa da equipe')).toBeInTheDocument();
  });

  it.each(['zoom.us/j/123', 'javascript:alert(1)', '/relativo'])(
    'hides the meeting link for %s',
    async (link) => {
      abrir(ocorrencia({ link_reuniao: link }));
      await screen.findByRole('dialog');
      expect(screen.queryByText('Entrar na reunião')).not.toBeInTheDocument();
    },
  );

  it('formats all-day and multi-day dates', async () => {
    const { unmount } = abrir(
      ocorrencia({
        dia_inteiro: true,
        data_inicio_local: '2026-10-05',
        data_fim_local: '2026-10-06',
      }),
    );
    expect(await screen.findByText('Segunda, 5 de outubro · Dia inteiro')).toBeInTheDocument();
    unmount();

    abrir(
      ocorrencia({
        dia_inteiro: true,
        data_inicio_local: '2026-10-05',
        data_fim_local: '2026-10-08',
      }),
    );
    expect(await screen.findByText('5 a 7 de outubro')).toBeInTheDocument();
  });

  it('formats an all-day range across months', async () => {
    abrir(
      ocorrencia({
        dia_inteiro: true,
        data_inicio_local: '2026-09-30',
        data_fim_local: '2026-10-03',
      }),
    );
    expect(await screen.findByText('30 de setembro a 2 de outubro')).toBeInTheDocument();
  });

  it('an end at midnight stays on the start day', async () => {
    abrir(
      ocorrencia({
        inicio: new Date(2026, 9, 5, 22, 0).toISOString(),
        fim: new Date(2026, 9, 6, 0, 0).toISOString(),
      }),
    );
    expect(await screen.findByText('Segunda, 5 de outubro · 22:00 a 00:00')).toBeInTheDocument();
  });

  it('a timed event past midnight shows both days', async () => {
    abrir(
      ocorrencia({
        inicio: new Date(2026, 9, 5, 22, 0).toISOString(),
        fim: new Date(2026, 9, 6, 2, 0).toISOString(),
      }),
    );
    expect(
      await screen.findByText('Segunda, 5 de outubro · 22:00 a terça, 6 de outubro · 02:00'),
    ).toBeInTheDocument();
  });

  it('labels all-day reminders', async () => {
    abrir(ocorrencia({ dia_inteiro: true, lembretes: [900, -540] }));
    expect(await screen.findByText('No dia às 9h, 1 dia antes às 9h')).toBeInTheDocument();
  });

  describe('RSVP', () => {
    it('answers a single event for all occurrences and refreshes the bell', async () => {
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      abrir(ocorrencia());
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      fireEvent.click(within(grupo).getByRole('button', { name: 'Sim' }));

      await waitFor(() => expect(responderEventoMock).toHaveBeenCalledWith(7, 'sim', 'todas'));
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] }),
      );
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications-unread-count'] });
    });

    it('marks the current answer', async () => {
      abrir(ocorrencia({ minha_resposta: 'talvez' }));
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      expect(within(grupo).getByRole('button', { name: 'Talvez' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(grupo).getByRole('button', { name: 'Sim' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('asks which occurrence on a recurring event', async () => {
      abrir(ocorrencia({ recorrente: true, regra: REGRA }));
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      fireEvent.click(within(grupo).getByRole('button', { name: 'Talvez' }));

      const alerta = await screen.findByRole('alertdialog', { name: 'Responder a qual evento?' });
      expect(responderEventoMock).not.toHaveBeenCalled();
      fireEvent.click(within(alerta).getByRole('button', { name: 'Este evento' }));
      await waitFor(() => expect(responderEventoMock).toHaveBeenCalledWith(7, 'talvez', 'esta'));
    });

    it('can answer every occurrence of a recurring event', async () => {
      abrir(ocorrencia({ recorrente: true, regra: REGRA }));
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      fireEvent.click(within(grupo).getByRole('button', { name: 'Não' }));
      const alerta = await screen.findByRole('alertdialog', { name: 'Responder a qual evento?' });
      fireEvent.click(within(alerta).getByRole('button', { name: 'Todos os eventos' }));
      await waitFor(() => expect(responderEventoMock).toHaveBeenCalledWith(7, 'nao', 'todas'));
    });

    it('shows the agenda error when the answer fails', async () => {
      responderEventoMock.mockRejectedValue({ message: 'agenda: este evento não existe mais' });
      abrir(ocorrencia());
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      fireEvent.click(within(grupo).getByRole('button', { name: 'Sim' }));
      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith('Este evento não existe mais'),
      );
    });

    it('closes and refreshes when the event no longer exists', async () => {
      responderEventoMock.mockRejectedValue({ message: 'agenda: este evento não existe mais' });
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      const { onClose } = abrir(ocorrencia({ recorrente: true, regra: REGRA }));
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      fireEvent.click(within(grupo).getByRole('button', { name: 'Sim' }));
      const alerta = await screen.findByRole('alertdialog', { name: 'Responder a qual evento?' });
      fireEvent.click(within(alerta).getByRole('button', { name: 'Todos os eventos' }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
      expect(toastErrorMock).toHaveBeenCalledWith('Este evento não existe mais');
    });

    it('keeps the popover open on other answer errors', async () => {
      responderEventoMock.mockRejectedValue(new Error('boom'));
      const { onClose } = abrir(ocorrencia());
      const grupo = await screen.findByRole('group', { name: 'Sua resposta' });
      fireEvent.click(within(grupo).getByRole('button', { name: 'Sim' }));
      await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Gravação: Clínica Sorriso' })).toBeInTheDocument();
    });

    it('is hidden when the user cannot answer', async () => {
      abrir(ocorrencia({ pode_responder: false }));
      await screen.findByRole('dialog');
      expect(screen.queryByRole('group', { name: 'Sua resposta' })).not.toBeInTheDocument();
    });
  });

  describe('edit and delete', () => {
    it('hides both actions without permission', async () => {
      abrir(ocorrencia({ pode_editar: false }));
      await screen.findByRole('dialog');
      expect(screen.queryByRole('button', { name: 'Editar evento' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Excluir evento' })).not.toBeInTheDocument();
    });

    it('hands the occurrence to onEditar', async () => {
      const o = ocorrencia();
      const { onEditar } = abrir(o);
      fireEvent.click(await screen.findByRole('button', { name: 'Editar evento' }));
      expect(onEditar).toHaveBeenCalledWith(o);
    });

    it('confirms before deleting a single event', async () => {
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      const { onClose } = abrir(ocorrencia());
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir evento' }));

      const alerta = await screen.findByRole('alertdialog', { name: 'Excluir evento?' });
      expect(
        within(alerta).getByText('Os participantes recebem um aviso de cancelamento.'),
      ).toBeInTheDocument();
      expect(excluirEventoMock).not.toHaveBeenCalled();
      fireEvent.click(within(alerta).getByRole('button', { name: 'Excluir' }));

      await waitFor(() => expect(excluirEventoMock).toHaveBeenCalledWith(7, 'todas'));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
      expect(toastSuccessMock).toHaveBeenCalledWith('Evento excluído');
    });

    it('cancelling the delete keeps the popover open', async () => {
      const { onClose } = abrir(ocorrencia());
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir evento' }));
      const alerta = await screen.findByRole('alertdialog', { name: 'Excluir evento?' });
      fireEvent.click(within(alerta).getByRole('button', { name: 'Cancelar' }));

      expect(
        await screen.findByRole('dialog', { name: 'Gravação: Clínica Sorriso' }),
      ).toBeVisible();
      expect(onClose).not.toHaveBeenCalled();
      expect(excluirEventoMock).not.toHaveBeenCalled();
    });

    it('asks the scope before deleting a recurring event', async () => {
      const { onClose } = abrir(ocorrencia({ recorrente: true, regra: REGRA }));
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir evento' }));

      const alerta = await screen.findByRole('alertdialog', {
        name: 'Excluir evento recorrente?',
      });
      fireEvent.click(within(alerta).getByRole('radio', { name: 'Todos os eventos' }));
      fireEvent.click(within(alerta).getByRole('button', { name: 'Excluir' }));

      await waitFor(() => expect(excluirEventoMock).toHaveBeenCalledWith(7, 'todas'));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('closes and refreshes when the event to delete no longer exists', async () => {
      excluirEventoMock.mockRejectedValue(new Error('agenda: este evento não existe mais'));
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      const { onClose } = abrir(ocorrencia({ recorrente: true, regra: REGRA }));
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir evento' }));
      const alerta = await screen.findByRole('alertdialog', {
        name: 'Excluir evento recorrente?',
      });
      fireEvent.click(within(alerta).getByRole('button', { name: 'Excluir' }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
      expect(toastErrorMock).toHaveBeenCalledWith('Este evento não existe mais');
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it('keeps the dialog and shows the error when the delete fails', async () => {
      excluirEventoMock.mockRejectedValue({ message: 'agenda: você não pode editar este evento' });
      const { onClose } = abrir(ocorrencia());
      fireEvent.click(await screen.findByRole('button', { name: 'Excluir evento' }));
      const alerta = await screen.findByRole('alertdialog', { name: 'Excluir evento?' });
      fireEvent.click(within(alerta).getByRole('button', { name: 'Excluir' }));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith('Você não pode editar este evento'),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('a masked event shows only Ocupado and the time', async () => {
    abrir(
      ocorrencia({
        titulo: 'Ocupado',
        mascarado: true,
        privado: true,
        descricao: null,
        local: null,
        link_reuniao: null,
        cliente_id: null,
        cliente_nome: null,
        tipo: null,
        lembretes: null,
        participantes: [
          { user_id: 'bruno', resposta: null },
          { user_id: 'me', resposta: null },
        ],
        minha_resposta: null,
        pode_editar: false,
        pode_responder: false,
      }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Ocupado' });
    expect(within(dialog).getByText('Segunda, 5 de outubro · 14:00 a 16:00')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Participantes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sua resposta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar evento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir evento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('closes on Esc and on the close button', async () => {
    const { onClose } = abrir(ocorrencia());
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on an outside click', async () => {
    const { onClose } = abrir(ocorrencia());
    await screen.findByRole('dialog');
    // Radix registers its outside-pointer listener on the next tick.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('survives an anchor that left the DOM', async () => {
    anchor.remove();
    abrir(ocorrencia());
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  describe('more actions menu', () => {
    // Radix opens a DropdownMenuTrigger on pointerdown, which jsdom lacks;
    // Enter on the trigger is the supported keyboard route.
    const abrirMenu = async () => {
      await screen.findByRole('dialog');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Mais ações' }), { key: 'Enter' });
    };

    it('offers the Google link and the .ics download', async () => {
      abrir(ocorrencia());
      await abrirMenu();
      expect(
        await screen.findByRole('menuitem', { name: 'Adicionar ao Google Agenda' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Baixar .ics' })).toBeInTheDocument();
    });

    it('is not offered for a masked event', async () => {
      abrir(ocorrencia({ mascarado: true }));
      await screen.findByRole('dialog');
      expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument();
    });

    it('opens the Google link in a new tab without an opener', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      const o = ocorrencia();
      abrir(o);
      await abrirMenu();
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Adicionar ao Google Agenda' }));
      expect(linkGoogleMock).toHaveBeenCalledWith(o);
      expect(open).toHaveBeenCalledTimes(1);
      const [url, alvo, features] = open.mock.calls[0];
      expect(String(url)).toContain('calendar.google.com');
      expect(alvo).toBe('_blank');
      expect(features).toBe('noopener,noreferrer');
      open.mockRestore();
    });

    it('downloads the occurrence as .ics', async () => {
      const o = ocorrencia();
      abrir(o);
      await abrirMenu();
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Baixar .ics' }));
      expect(baixarIcsMock).toHaveBeenCalledWith(o);
    });
  });
});

describe('EventoPopover: cliente e remarcação', () => {
  const PEDIDO = {
    id: 41,
    // Friday, 9 Oct 2026 14:00 in the runner's zone (timed events render in the browser zone).
    inicio_sugerido: new Date(2026, 9, 9, 14, 0).toISOString(),
    fim_sugerido: new Date(2026, 9, 9, 16, 0).toISOString(),
    mensagem: 'Sexta fica melhor para a equipe da clínica.',
    criado_em: new Date(2026, 9, 3, 10, 0).toISOString(),
  };
  const compartilhado = (p: Partial<AgendaOcorrencia> = {}) =>
    ocorrencia({ compartilhado_cliente: true, cliente_resposta: 'aguardando', ...p });

  it.each([
    ['sim', 'Confirmou'],
    ['nao', 'Recusou'],
    ['aguardando', 'Aguardando resposta'],
  ] as const)('shows the client state: %s -> %s', async (resposta, rotulo) => {
    abrir(compartilhado({ cliente_resposta: resposta }));
    expect(await screen.findByText(`Cliente: Clínica Sorriso · ${rotulo}`)).toBeInTheDocument();
  });

  it('shows no client state for an event that is not shared', async () => {
    abrir(ocorrencia());
    expect(await screen.findByText('Cliente: Clínica Sorriso')).toBeInTheDocument();
  });

  it('renders the pending request with the formatted date and the client message', async () => {
    abrir(compartilhado({ remarcacao_pendente: PEDIDO }));
    const bloco = await screen.findByRole('group', { name: 'Pedido de remarcação' });
    expect(
      within(bloco).getByText('Clínica Sorriso pediu para remarcar para sex., 9 de out., 14:00'),
    ).toBeInTheDocument();
    expect(
      within(bloco).getByText('Sexta fica melhor para a equipe da clínica.'),
    ).toBeInTheDocument();
    expect(within(bloco).getByRole('button', { name: 'Aceitar' })).toBeInTheDocument();
    expect(within(bloco).getByRole('button', { name: 'Recusar' })).toBeInTheDocument();
  });

  it('Aceitar resolves the request, refreshes the agenda and closes', async () => {
    const { onClose } = abrir(compartilhado({ remarcacao_pendente: PEDIDO }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
    await waitFor(() => expect(resolverRemarcacaoMock).toHaveBeenCalledWith(41, true, undefined));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
    expect(toastSuccessMock).toHaveBeenCalledWith('Remarcação aceita');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Recusar opens an optional message; Enviar sends it', async () => {
    const { onClose } = abrir(compartilhado({ remarcacao_pendente: PEDIDO }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem para o cliente' }), {
      target: { value: 'Sexta o estúdio está fechado.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(resolverRemarcacaoMock).toHaveBeenCalledWith(
        41,
        false,
        'Sexta o estúdio está fechado.',
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
    expect(toastSuccessMock).toHaveBeenCalledWith('Remarcação recusada');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Voltar returns to the two buttons and drops the typed message', async () => {
    abrir(compartilhado({ remarcacao_pendente: PEDIDO }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem para o cliente' }), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(screen.getByRole('textbox', { name: 'Mensagem para o cliente' })).toHaveValue('');
  });

  it('shows the RPC error, keeps the popover open and re-enables the buttons', async () => {
    resolverRemarcacaoMock.mockRejectedValue({
      message: 'agenda: esse horário já passou. Combine outro com o cliente.',
    });
    const { onClose } = abrir(compartilhado({ remarcacao_pendente: PEDIDO }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Esse horário já passou. Combine outro com o cliente.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Aceitar' })).toBeEnabled();
  });

  it('closes and refreshes when someone already resolved the request', async () => {
    resolverRemarcacaoMock.mockRejectedValue({
      message: 'agenda: este pedido já foi resolvido.',
    });
    const { onClose } = abrir(compartilhado({ remarcacao_pendente: PEDIDO }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Este pedido já foi resolvido.'),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the request block without edit permission but keeps the client state', async () => {
    abrir(
      compartilhado({
        pode_editar: false,
        cliente_resposta: 'aguardando',
        remarcacao_pendente: PEDIDO,
      }),
    );
    expect(
      await screen.findByText('Cliente: Clínica Sorriso · Aguardando resposta'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Pedido de remarcação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recusar' })).toBeNull();
  });

  it('shows nothing of the client on a masked (private) event', async () => {
    abrir(
      compartilhado({
        mascarado: true,
        pode_editar: false,
        titulo: 'Ocupado',
        remarcacao_pendente: PEDIDO,
      }),
    );
    await screen.findByRole('dialog', { name: 'Ocupado' });
    expect(screen.queryByText(/Cliente:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
  });
});
