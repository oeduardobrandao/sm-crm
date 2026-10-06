import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaOcorrencia } from '../../../../store/agenda';
import { paredeNoFuso } from '../agendaLogic';
import { useAgendaMutations } from '../useAgendaMutations';

const { editarEventoMock, toastMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  editarEventoMock: vi.fn(),
  toastMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/store/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/agenda')>()),
  editarEvento: editarEventoMock,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(toastMock, { success: toastSuccessMock, error: toastErrorMock }),
}));

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function ocorrencia(p: Partial<AgendaOcorrencia> = {}): AgendaOcorrencia {
  return {
    ocorrencia_id: 7,
    evento_id: 3,
    data_original: '2026-10-05',
    inicio: new Date(2026, 9, 5, 14, 0).toISOString(),
    fim: new Date(2026, 9, 5, 16, 0).toISOString(),
    dia_inteiro: false,
    data_inicio_local: '2026-10-05',
    data_fim_local: '2026-10-05',
    titulo: 'Gravação: Clínica Sorriso',
    descricao: null,
    local: null,
    link_reuniao: null,
    tipo: 'gravacao',
    cor: null,
    cliente_id: null,
    cliente_nome: null,
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [10],
    organizador_id: 'me',
    participantes: [{ user_id: 'me', resposta: 'sim' }],
    minha_resposta: 'sim',
    pode_editar: true,
    pode_responder: false,
    tz: TZ,
    ...p,
  };
}

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setup() {
  return renderHook(() => useAgendaMutations(), { wrapper });
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  editarEventoMock.mockReset();
  toastMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

describe('useAgendaMutations.mover', () => {
  it('moves a timed non-recurring event with a partial payload in the series tz', async () => {
    editarEventoMock.mockResolvedValue(70);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = setup();
    const novoInicio = new Date(2026, 9, 6, 9, 30);
    const novoFim = new Date(2026, 9, 6, 11, 30);
    const revert = vi.fn();

    act(() => result.current.mover(ocorrencia(), novoInicio, novoFim, revert));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(editarEventoMock).toHaveBeenCalledTimes(1);
    expect(editarEventoMock).toHaveBeenCalledWith(
      7,
      'todas',
      { inicio_local: paredeNoFuso(novoInicio, TZ), fim_local: paredeNoFuso(novoFim, TZ) },
      null,
    );
    expect(Object.keys(editarEventoMock.mock.calls[0][2])).toEqual(['inicio_local', 'fim_local']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
    expect(revert).not.toHaveBeenCalled();
    expect(result.current.dialog).toBeNull();

    const [mensagem, opcoes] = toastMock.mock.calls[0];
    expect(mensagem).toBe('Evento movido');
    expect(opcoes.action.label).toBe('Desfazer');
  });

  it('Desfazer puts the old times back on the occurrence the RPC returned', async () => {
    editarEventoMock.mockResolvedValueOnce(70).mockResolvedValueOnce(71);
    const { result } = setup();
    const o = ocorrencia();
    act(() =>
      result.current.mover(o, new Date(2026, 9, 6, 9, 0), new Date(2026, 9, 6, 11, 0), vi.fn()),
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalled());

    await act(async () => {
      toastMock.mock.calls[0][1].action.onClick();
    });

    expect(editarEventoMock).toHaveBeenCalledTimes(2);
    expect(editarEventoMock).toHaveBeenLastCalledWith(
      70,
      'todas',
      {
        inicio_local: paredeNoFuso(new Date(o.inicio), TZ),
        fim_local: paredeNoFuso(new Date(o.fim), TZ),
      },
      null,
    );
  });

  it('all-day moves send date strings with the exclusive end as is', async () => {
    editarEventoMock.mockResolvedValue(7);
    const { result } = setup();
    const o = ocorrencia({
      dia_inteiro: true,
      data_inicio_local: '2026-10-05',
      data_fim_local: '2026-10-07',
    });

    act(() => result.current.mover(o, new Date(2026, 9, 8), new Date(2026, 9, 10), vi.fn()));

    await waitFor(() => expect(editarEventoMock).toHaveBeenCalled());
    expect(editarEventoMock).toHaveBeenCalledWith(
      7,
      'todas',
      { inicio_local: '2026-10-08T00:00:00', fim_local: '2026-10-10T00:00:00' },
      null,
    );
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    await act(async () => {
      toastMock.mock.calls[0][1].action.onClick();
    });
    expect(editarEventoMock).toHaveBeenLastCalledWith(
      7,
      'todas',
      { inicio_local: '2026-10-05T00:00:00', fim_local: '2026-10-07T00:00:00' },
      null,
    );
  });

  it('an all-day drop without an end keeps one day', async () => {
    editarEventoMock.mockResolvedValue(7);
    const { result } = setup();
    const dia = new Date(2026, 9, 8);
    act(() => result.current.mover(ocorrencia({ dia_inteiro: true }), dia, dia, vi.fn()));
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalled());
    expect(editarEventoMock.mock.calls[0][2]).toEqual({
      inicio_local: '2026-10-08T00:00:00',
      fim_local: '2026-10-09T00:00:00',
    });
  });

  it('reverts and shows the agenda error when the save fails', async () => {
    editarEventoMock.mockRejectedValue({ message: 'agenda: você não pode editar este evento' });
    const { result } = setup();
    const revert = vi.fn();
    act(() =>
      result.current.mover(
        ocorrencia(),
        new Date(2026, 9, 6, 9, 0),
        new Date(2026, 9, 6, 10, 0),
        revert,
      ),
    );
    await waitFor(() => expect(revert).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith('Você não pode editar este evento');
    expect(toastMock).not.toHaveBeenCalled();
  });

  describe('recurring', () => {
    const serie = () => ocorrencia({ recorrente: true, regra: null });

    /** Renders the hook's dialog the way AgendaTab does. */
    function montar() {
      const api: { current: ReturnType<typeof useAgendaMutations> | null } = { current: null };
      function Harness() {
        const m = useAgendaMutations();
        api.current = m;
        return <>{m.dialog}</>;
      }
      render(<Harness />, { wrapper });
      return (o: AgendaOcorrencia, ini: Date, fim: Date, revert: () => void) =>
        act(() => api.current!.mover(o, ini, fim, revert));
    }

    it('asks for the scope first and reverts on cancel', () => {
      const mover = montar();
      const revert = vi.fn();
      mover(serie(), new Date(2026, 9, 6, 9, 0), new Date(2026, 9, 6, 10, 0), revert);

      expect(editarEventoMock).not.toHaveBeenCalled();
      expect(screen.getByText('Editar evento recorrente')).toBeInTheDocument();
      // "Este evento" is allowed: a time move is not a series change.
      expect(screen.getByRole('radio', { name: 'Este evento' })).not.toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(revert).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Editar evento recorrente')).not.toBeInTheDocument();
      expect(editarEventoMock).not.toHaveBeenCalled();
    });

    it('saves with the chosen scope and the partial payload', async () => {
      editarEventoMock.mockResolvedValue(9);
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      const mover = montar();
      const novoInicio = new Date(2026, 9, 6, 9, 0);
      const novoFim = new Date(2026, 9, 6, 10, 0);
      const revert = vi.fn();
      mover(serie(), novoInicio, novoFim, revert);

      fireEvent.click(screen.getByRole('radio', { name: 'Este e os seguintes' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() =>
        expect(screen.queryByText('Editar evento recorrente')).not.toBeInTheDocument(),
      );
      expect(editarEventoMock).toHaveBeenCalledTimes(1);
      expect(editarEventoMock).toHaveBeenCalledWith(
        7,
        'seguintes',
        { inicio_local: paredeNoFuso(novoInicio, TZ), fim_local: paredeNoFuso(novoFim, TZ) },
        null,
      );
      expect(toastMock).toHaveBeenCalledWith('Evento movido');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
      expect(revert).not.toHaveBeenCalled();
    });

    it('reverts and closes the dialog when the scoped save fails', async () => {
      editarEventoMock.mockRejectedValue(new Error('boom'));
      const mover = montar();
      const revert = vi.fn();
      mover(serie(), new Date(2026, 9, 6, 9, 0), new Date(2026, 9, 6, 10, 0), revert);

      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(revert).toHaveBeenCalledTimes(1));
      expect(editarEventoMock).toHaveBeenCalledWith(7, 'esta', expect.any(Object), null);
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Não foi possível salvar o evento. Tente novamente.',
      );
      expect(screen.queryByText('Editar evento recorrente')).not.toBeInTheDocument();
    });
  });
});
