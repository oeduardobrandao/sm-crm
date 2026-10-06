import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaOcorrencia } from '../../../../store/agenda';

const {
  criarEventoMock,
  editarEventoMock,
  getClientesMock,
  getWorkspaceUsersMock,
  toastMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  criarEventoMock: vi.fn(),
  editarEventoMock: vi.fn(),
  getClientesMock: vi.fn(),
  getWorkspaceUsersMock: vi.fn(),
  toastMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/store/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/agenda')>()),
  criarEvento: criarEventoMock,
  editarEvento: editarEventoMock,
}));
vi.mock('@/store/clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/clients')>()),
  getClientes: getClientesMock,
}));
vi.mock('@/store/workspace', () => ({ getWorkspaceUsers: getWorkspaceUsersMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
// The runner's zone must not matter: the "browser" is in São Paulo.
vi.mock('../agendaLogic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agendaLogic')>()),
  fusoDoNavegador: () => 'America/Sao_Paulo',
}));
vi.mock('sonner', () => ({
  toast: Object.assign(toastMock, { success: toastSuccessMock, error: toastErrorMock }),
}));

/** Text content of a React subtree (option children must be plain text). */
function texto(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(texto).join('');
  if (React.isValidElement(node)) {
    return texto((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

/** aria-label of the SelectTrigger somewhere under a Select. */
function rotuloDoTrigger(node: React.ReactNode): string | undefined {
  let achado: string | undefined;
  React.Children.forEach(node, (c) => {
    if (achado || !React.isValidElement(c)) return;
    const props = c.props as { 'aria-label'?: string; children?: React.ReactNode };
    achado = props['aria-label'] ?? rotuloDoTrigger(props.children);
  });
  return achado;
}

// jsdom cannot drive Radix Select; a native stand-in (as in TarefaFormDialog.test.tsx).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      aria-label={rotuloDoTrigger(children)}
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectSeparator: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{texto(children)}</option>
  ),
}));
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value?: Date;
    onChange?: (d: Date | undefined) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const v = value
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      : '';
    return (
      <input
        type="date"
        aria-label={placeholder}
        value={v}
        disabled={disabled}
        onChange={(e) =>
          onChange?.(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)
        }
      />
    );
  },
}));

import { EventoFormDialog } from '../EventoFormDialog';

const PESSOAS = [
  { id: 'org', nome: 'Olga Organizadora', avatar_url: null },
  { id: 'me', nome: 'Eu Mesmo', avatar_url: null },
  { id: 'u1', nome: 'Ana Lima', avatar_url: null },
  { id: 'u2', nome: 'Bruno Reis', avatar_url: null },
];

beforeEach(() => {
  getClientesMock.mockResolvedValue([
    { id: 12, nome: 'Clínica Sorriso', status: 'ativo' },
    { id: 13, nome: 'Antiga', status: 'encerrado' },
  ]);
  getWorkspaceUsersMock.mockResolvedValue(PESSOAS);
  criarEventoMock.mockResolvedValue({
    evento_id: 1,
    ocorrencia_id: 10,
    dtstart: '2026-10-05T14:00:00',
  });
  editarEventoMock.mockResolvedValue(7);
  Element.prototype.scrollIntoView = vi.fn();
});

function ocorrencia(p: Partial<AgendaOcorrencia> = {}): AgendaOcorrencia {
  return {
    ocorrencia_id: 7,
    evento_id: 3,
    data_original: '2026-10-05',
    // 14:00 to 16:00 in São Paulo (UTC-3).
    inicio: '2026-10-05T17:00:00+00:00',
    fim: '2026-10-05T19:00:00+00:00',
    dia_inteiro: false,
    data_inicio_local: '2026-10-05',
    data_fim_local: '2026-10-06',
    titulo: 'Gravação: Clínica Sorriso',
    descricao: null,
    local: null,
    link_reuniao: null,
    tipo: 'gravacao',
    cor: null,
    cliente_id: 12,
    cliente_nome: 'Clínica Sorriso',
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [10],
    organizador_id: 'org',
    participantes: [
      { user_id: 'org', resposta: 'sim' },
      { user_id: 'u1', resposta: 'pendente' },
    ],
    minha_resposta: null,
    pode_editar: true,
    pode_responder: false,
    tz: 'America/Sao_Paulo',
    ...p,
  };
}

const SEMANAL_SEG = {
  freq: 'weekly' as const,
  intervalo: 1,
  dias_semana: [1],
  mensal_modo: null,
  mensal_ordinal: null,
  ate: null,
  contagem: null,
};

function montar(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { ...utils, invalidate };
}

function criar(
  inicial = {
    inicio: new Date(2026, 9, 5, 14, 0),
    fim: new Date(2026, 9, 5, 15, 0),
    diaInteiro: false,
  },
) {
  const onOpenChange = vi.fn();
  const r = montar(
    <EventoFormDialog open onOpenChange={onOpenChange} modo="criar" inicial={inicial} />,
  );
  return { ...r, onOpenChange };
}

function editar(o: AgendaOcorrencia) {
  const onOpenChange = vi.fn();
  const r = montar(
    <EventoFormDialog open onOpenChange={onOpenChange} modo="editar" ocorrencia={o} />,
  );
  return { ...r, onOpenChange };
}

const titulo = () => screen.getByLabelText('Título') as HTMLInputElement;
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
const select = (nome: string) => screen.getByRole('combobox', { name: nome }) as HTMLSelectElement;

describe('EventoFormDialog: criar', () => {
  it('submits criarEvento with local wall clocks, the browser tz and [10] reminders', async () => {
    const { onOpenChange, invalidate } = criar();
    expect(screen.getByText('Novo evento')).toBeInTheDocument();
    fireEvent.change(titulo(), { target: { value: 'Reunião de pauta' } });
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    const [payload, participantes] = criarEventoMock.mock.calls[0];
    expect(payload).toEqual({
      titulo: 'Reunião de pauta',
      descricao: null,
      local: null,
      link_reuniao: null,
      tipo: 'reuniao',
      cor: null,
      cliente_id: null,
      privado: false,
      dia_inteiro: false,
      tz: 'America/Sao_Paulo',
      inicio_local: '2026-10-05T14:00:00',
      fim_local: '2026-10-05T15:00:00',
      lembretes: [10],
      regra: null,
    });
    expect(participantes).toEqual([]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccessMock).toHaveBeenCalledWith('Evento criado');
    expect(toastMock).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
  });

  it('shows the schema messages and does not submit', async () => {
    criar();
    fireEvent.change(screen.getByLabelText('Link da reunião'), { target: { value: 'meet.com/x' } });
    salvar();
    expect(await screen.findByText('Informe um título.')).toBeInTheDocument();
    expect(
      screen.getByText('Informe um link que comece com http:// ou https://.'),
    ).toBeInTheDocument();
    expect(criarEventoMock).not.toHaveBeenCalled();
  });

  it('rejects an end before the start', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'x' } });
    fireEvent.change(select('Hora de fim'), { target: { value: '13:00' } });
    salvar();
    expect(await screen.findByText('O fim precisa ser depois do início.')).toBeInTheDocument();
    expect(criarEventoMock).not.toHaveBeenCalled();
  });

  it('labels end options after the start with the duration', () => {
    criar();
    const opcoes = Array.from(select('Hora de fim').options).map((o) => o.textContent);
    expect(opcoes).toContain('15:30 (1 h 30 min)');
    expect(opcoes).toContain('14:15 (15 min)');
    expect(opcoes).toContain('13:00');
    expect(select('Hora de início').options).toHaveLength(96);
  });

  it('keeps the duration when the start time moves', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'x' } });
    fireEvent.change(select('Hora de início'), { target: { value: '16:30' } });
    expect(select('Hora de fim').value).toBe('17:30');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][0]).toMatchObject({
      inicio_local: '2026-10-05T16:30:00',
      fim_local: '2026-10-05T17:30:00',
    });
  });

  it('Dia inteiro hides the times, clears reminders and sends the exclusive end', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Feriado' } });
    expect(screen.getByText('10 minutos antes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Dia inteiro' }));
    expect(screen.queryByRole('combobox', { name: 'Hora de início' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Hora de fim' })).not.toBeInTheDocument();
    expect(screen.queryByText('10 minutos antes')).not.toBeInTheDocument();
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][0]).toMatchObject({
      dia_inteiro: true,
      inicio_local: '2026-10-05T00:00:00',
      fim_local: '2026-10-06T00:00:00',
      lembretes: [],
    });
  });

  it('toggling Dia inteiro off restores the times and the default reminder', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Dia inteiro' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Dia inteiro' }));
    expect(select('Hora de início').value).toBe('14:00');
    expect(select('Hora de fim').value).toBe('15:00');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][0]).toMatchObject({
      dia_inteiro: false,
      inicio_local: '2026-10-05T14:00:00',
      fim_local: '2026-10-05T15:00:00',
      lembretes: [10],
    });
  });

  it('starts all-day from an all-day selection with an exclusive end', async () => {
    criar({ inicio: new Date(2026, 9, 5), fim: new Date(2026, 9, 7), diaInteiro: true });
    fireEvent.change(titulo(), { target: { value: 'Viagem' } });
    expect((screen.getByLabelText('Data de fim') as HTMLInputElement).value).toBe('2026-10-06');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][0]).toMatchObject({
      dia_inteiro: true,
      inicio_local: '2026-10-05T00:00:00',
      fim_local: '2026-10-07T00:00:00',
      lembretes: [],
    });
  });

  it('a weekly preset follows the start date', async () => {
    criarEventoMock.mockResolvedValue({
      evento_id: 1,
      ocorrencia_id: 10,
      dtstart: '2026-10-07T14:00:00',
    });
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.change(select('Repetir'), { target: { value: 'semanal' } });
    expect(select('Repetir').selectedOptions[0].textContent).toBe('Semanal: cada segunda');
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2026-10-07' } });
    expect(select('Repetir').value).toBe('semanal');
    expect(select('Repetir').selectedOptions[0].textContent).toBe('Semanal: cada quarta');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][0]).toMatchObject({
      inicio_local: '2026-10-07T14:00:00',
      fim_local: '2026-10-07T15:00:00',
      regra: { freq: 'weekly', intervalo: 1, dias_semana: [3] },
    });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Evento criado'));
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('moves the monthly ordinal to "última" when the new date has no such ordinal', () => {
    criar({
      inicio: new Date(2026, 9, 26, 14, 0),
      fim: new Date(2026, 9, 26, 15, 0),
      diaInteiro: false,
    });
    fireEvent.change(select('Repetir'), { target: { value: 'mensal_ordinal' } });
    expect(select('Repetir').selectedOptions[0].textContent).toBe('Mensal: na quarta segunda');
    // 2026-10-29 is the 5th Thursday: only "última" exists.
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2026-10-29' } });
    expect(select('Repetir').value).toBe('mensal_ultima');
  });

  it('warns when the series starts on another day, even without an occurrence id', async () => {
    criarEventoMock.mockResolvedValue({
      evento_id: 1,
      ocorrencia_id: null,
      dtstart: '2026-10-12T14:00:00',
    });
    const { onOpenChange, invalidate } = criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.change(select('Repetir'), { target: { value: 'mensal_dia' } });
    salvar();
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('A série começa em segunda, 12 de outubro.'),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Evento criado');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('builds a custom rule in the Repetição personalizada dialog', async () => {
    const { onOpenChange } = criar();
    fireEvent.change(titulo(), { target: { value: 'Sprint' } });
    fireEvent.change(select('Repetir'), { target: { value: 'personalizado' } });
    const dlg = await screen.findByRole('dialog', { name: 'Repetição personalizada' });
    fireEvent.change(within(dlg).getByLabelText('Repetir a cada'), { target: { value: '2' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'quarta' }));
    expect(within(dlg).getByText('A cada 2 semanas na segunda e na quarta')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByLabelText('Após'));
    fireEvent.change(within(dlg).getByLabelText('Número de ocorrências'), {
      target: { value: '6' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Concluir' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Repetição personalizada' })).toBeNull(),
    );
    expect(select('Repetir').selectedOptions[0].textContent).toBe(
      'A cada 2 semanas na segunda e na quarta, 6 vezes',
    );
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][0].regra).toEqual({
      freq: 'weekly',
      intervalo: 2,
      dias_semana: [1, 3],
      mensal_modo: null,
      mensal_ordinal: null,
      ate: null,
      contagem: 6,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('cancelling the custom dialog keeps the previous choice, and Esc closes only it', async () => {
    const { onOpenChange } = criar();
    fireEvent.change(select('Repetir'), { target: { value: 'diario' } });
    fireEvent.change(select('Repetir'), { target: { value: 'personalizado' } });
    await screen.findByRole('dialog', { name: 'Repetição personalizada' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Repetição personalizada' })).toBeNull(),
    );
    expect(select('Repetir').value).toBe('diario');
    expect(screen.getByRole('dialog', { name: 'Novo evento' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('adds people from the team roster, never the organizer', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar pessoa da equipe/ }));
    const ana = await screen.findByRole('option', { name: /Ana Lima/ });
    expect(screen.queryByRole('option', { name: /Eu Mesmo/ })).toBeNull();
    fireEvent.click(ana);
    expect(screen.getByRole('button', { name: 'Remover Ana Lima' })).toBeInTheDocument();
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalled());
    expect(criarEventoMock.mock.calls[0][1]).toEqual(['u1']);
  });

  it('Esc on a dirty form asks before closing; a clean one closes', async () => {
    const { onOpenChange } = criar();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();

    fireEvent.change(titulo(), { target: { value: 'Algo' } });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(await screen.findByText('Fechar sem salvar?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('Cancelar on a dirty form asks too', async () => {
    const { onOpenChange } = criar();
    fireEvent.change(titulo(), { target: { value: 'Algo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Fechar sem salvar?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar mesmo assim' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// What every todas/seguintes edit of ocorrencia() carries (rule always explicit),
// and the content keys every esta edit carries.
const SERIE = {
  regra: null,
  tipo: 'gravacao',
  cor: null,
  cliente_id: 12,
  privado: false,
  dia_inteiro: false,
  lembretes: [10],
};
const CONTEUDO = {
  titulo: 'Gravação: Clínica Sorriso',
  descricao: null,
  local: null,
  link_reuniao: null,
};

describe('EventoFormDialog: editar', () => {
  it('pre-fills in the series tz and saves a one-off with todas, no times and no tz', async () => {
    const { onOpenChange, invalidate } = editar(ocorrencia());
    expect(screen.getByText('Editar evento')).toBeInTheDocument();
    expect(titulo().value).toBe('Gravação: Clínica Sorriso');
    expect(select('Hora de início').value).toBe('14:00');
    expect(select('Hora de fim').value).toBe('16:00');
    expect(screen.queryByText(/Horários no fuso/)).toBeNull();
    await waitFor(() => expect(select('Cliente').value).toBe('12'));
    fireEvent.change(titulo(), { target: { value: 'Gravação: novembro' } });
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalledTimes(1));
    expect(editarEventoMock).toHaveBeenCalledWith(
      7,
      'todas',
      { ...SERIE, titulo: 'Gravação: novembro' },
      null,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccessMock).toHaveBeenCalledWith('Evento atualizado');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
  });

  it('shows and edits times in a series tz other than the browser one', async () => {
    // 14:00 to 16:00 in New York (UTC-4 in October).
    editar(
      ocorrencia({
        inicio: '2026-10-05T18:00:00+00:00',
        fim: '2026-10-05T20:00:00+00:00',
        tz: 'America/New_York',
      }),
    );
    expect(screen.getByText('Horários no fuso America/New_York')).toBeInTheDocument();
    expect(select('Hora de início').value).toBe('14:00');
    fireEvent.change(select('Hora de início'), { target: { value: '15:00' } });
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalled());
    const payload = editarEventoMock.mock.calls[0][2];
    expect(payload).toEqual({
      ...SERIE,
      inicio_local: '2026-10-05T15:00:00',
      fim_local: '2026-10-05T17:00:00',
    });
    expect('tz' in payload).toBe(false);
  });

  it('closes without a call when nothing changed', async () => {
    const { onOpenChange } = editar(ocorrencia());
    salvar();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(editarEventoMock).not.toHaveBeenCalled();
  });

  it('asks the scope of a recurring edit and locks "Este evento" when reminders changed', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
    expect(select('Repetir').value).toBe('semanal');
    fireEvent.click(screen.getByRole('button', { name: 'Remover lembrete 10 minutos antes' }));
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    expect(within(dlg).getByRole('radio', { name: 'Este evento' })).toBeDisabled();
    expect(within(dlg).getByRole('radio', { name: 'Este e os seguintes' })).toBeChecked();
    expect(
      within(dlg).getByText('Vale para toda a série: você mudou os lembretes.'),
    ).toBeInTheDocument();
    expect(editarEventoMock).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(editarEventoMock).toHaveBeenCalledWith(
        7,
        'seguintes',
        { ...SERIE, regra: SEMANAL_SEG, lembretes: [] },
        null,
      ),
    );
  });

  it('uses the generic helper when several series fields changed', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover lembrete 10 minutos antes' }));
    fireEvent.change(select('Tipo'), { target: { value: 'reuniao' } });
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    expect(within(dlg).getByText('Vale para toda a série.')).toBeInTheDocument();
  });

  it('names the participants when they changed and sends the new set', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remover Ana Lima' }));
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    expect(
      within(dlg).getByText('Vale para toda a série: você mudou os participantes.'),
    ).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Todos os eventos' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(editarEventoMock).toHaveBeenCalledWith(
        7,
        'todas',
        { ...SERIE, regra: SEMANAL_SEG },
        [],
      ),
    );
  });

  it('moving one occurrence keeps "Este evento" and leaves the rule out', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2026-10-07' } });
    expect(select('Repetir').selectedOptions[0].textContent).toBe('Semanal: cada quarta');
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    const este = within(dlg).getByRole('radio', { name: 'Este evento' });
    expect(este).toBeEnabled();
    expect(este).toBeChecked();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(editarEventoMock).toHaveBeenCalledWith(
        7,
        'esta',
        { ...CONTEUDO, inicio_local: '2026-10-07T14:00:00', fim_local: '2026-10-07T16:00:00' },
        null,
      ),
    );
  });

  it('moving with "Todos os eventos" sends the rule that followed the date', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2026-10-07' } });
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Todos os eventos' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalled());
    expect(editarEventoMock.mock.calls[0][1]).toBe('todas');
    expect(editarEventoMock.mock.calls[0][2]).toEqual({
      ...SERIE,
      inicio_local: '2026-10-07T14:00:00',
      fim_local: '2026-10-07T16:00:00',
      regra: { ...SEMANAL_SEG, dias_semana: [3] },
    });
  });

  it('an end-time-only edit of a one-off sends both time keys', async () => {
    editar(ocorrencia());
    fireEvent.change(select('Hora de fim'), { target: { value: '16:30' } });
    salvar();
    await waitFor(() =>
      expect(editarEventoMock).toHaveBeenCalledWith(
        7,
        'todas',
        { ...SERIE, inicio_local: '2026-10-05T14:00:00', fim_local: '2026-10-05T16:30:00' },
        null,
      ),
    );
  });

  it.each([
    ['Este evento', 'esta', CONTEUDO],
    ['Todos os eventos', 'todas', { ...SERIE, regra: SEMANAL_SEG }],
  ] as const)(
    'an end-time-only recurring edit with "%s" sends both time keys',
    async (opcao, esc, resto) => {
      editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
      fireEvent.change(select('Hora de fim'), { target: { value: '16:30' } });
      salvar();
      const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
      expect(within(dlg).getByRole('radio', { name: 'Este evento' })).toBeEnabled();
      fireEvent.click(within(dlg).getByRole('radio', { name: opcao }));
      fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
      await waitFor(() =>
        expect(editarEventoMock).toHaveBeenCalledWith(
          7,
          esc,
          { ...resto, inicio_local: '2026-10-05T14:00:00', fim_local: '2026-10-05T16:30:00' },
          null,
        ),
      );
    },
  );

  it('an all-day end-date-only edit sends both time keys', async () => {
    editar(
      ocorrencia({
        dia_inteiro: true,
        inicio: '2026-10-05T03:00:00+00:00',
        fim: '2026-10-06T03:00:00+00:00',
        lembretes: [],
      }),
    );
    fireEvent.change(screen.getByLabelText('Data de fim'), { target: { value: '2026-10-07' } });
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalled());
    expect(editarEventoMock.mock.calls[0][2]).toEqual({
      ...SERIE,
      dia_inteiro: true,
      lembretes: [],
      inicio_local: '2026-10-05T00:00:00',
      fim_local: '2026-10-08T00:00:00',
    });
  });

  it('"todas" from an occurrence with a title override keeps the title and times out', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG, titulo: 'Só nesta semana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover lembrete 10 minutos antes' }));
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Todos os eventos' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalled());
    const payload = editarEventoMock.mock.calls[0][2];
    expect(payload).toEqual({ ...SERIE, regra: SEMANAL_SEG, lembretes: [] });
    expect('titulo' in payload).toBe(false);
    expect('inicio_local' in payload || 'fim_local' in payload).toBe(false);
  });

  it('treats a null occurrence id from editarEvento as success', async () => {
    editarEventoMock.mockResolvedValue(null);
    const { onOpenChange, invalidate } = editar(ocorrencia());
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2029-01-08' } });
    salvar();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Evento atualizado'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('cancelling the scope dialog keeps the form open', async () => {
    const { onOpenChange } = editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG }));
    fireEvent.change(titulo(), { target: { value: 'Outro' } });
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(editarEventoMock).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes when the event no longer exists', async () => {
    editarEventoMock.mockRejectedValue({ message: 'agenda: este evento não existe mais' });
    const { onOpenChange, invalidate } = editar(ocorrencia());
    fireEvent.change(titulo(), { target: { value: 'Outro' } });
    salvar();
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Este evento não existe mais'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agenda-ocorrencias'] });
  });

  it('stays open on other server errors', async () => {
    editarEventoMock.mockRejectedValue({ message: 'agenda: link da reunião inválido' });
    const { onOpenChange } = editar(ocorrencia());
    fireEvent.change(titulo(), { target: { value: 'Outro' } });
    salvar();
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Link da reunião inválido'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Editar evento' })).toBeInTheDocument();
  });
});
