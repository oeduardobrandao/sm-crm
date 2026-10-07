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
  hasFeatureMock,
} = vi.hoisted(() => ({
  criarEventoMock: vi.fn(),
  editarEventoMock: vi.fn(),
  getClientesMock: vi.fn(),
  getWorkspaceUsersMock: vi.fn(),
  toastMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  hasFeatureMock: vi.fn(),
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
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ hasFeature: hasFeatureMock }),
}));
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
  hasFeatureMock.mockReset().mockReturnValue(true);
  getClientesMock.mockResolvedValue([
    { id: 12, nome: 'Clínica Sorriso', status: 'ativo', email: 'contato@sorriso.com' },
    { id: 13, nome: 'Antiga', status: 'encerrado', email: 'antiga@x.com' },
    { id: 14, nome: 'Sem Email', status: 'ativo', email: '' },
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
    compartilhado_cliente: false,
    cliente_resposta: null,
    remarcacao_pendente: null,
    sequencia: 0,
    convidados: [],
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

describe('EventoFormDialog: rascunho do card rápido', () => {
  const INICIAL = {
    inicio: new Date(2026, 9, 5, 14, 0),
    fim: new Date(2026, 9, 5, 15, 0),
    diaInteiro: false,
  };
  const comRascunho = (rascunho: Partial<import('../eventoFormSchema').EventoFormValues>) => {
    const onOpenChange = vi.fn();
    const r = montar(
      <EventoFormDialog
        open
        onOpenChange={onOpenChange}
        modo="criar"
        inicial={INICIAL}
        rascunho={rascunho}
      />,
    );
    return { ...r, onOpenChange };
  };

  it('starts from the draft values and asks before discarding them', async () => {
    const { onOpenChange } = comRascunho({ titulo: 'Pauta', participantes: ['u1'] });
    expect(titulo().value).toBe('Pauta');
    expect(await screen.findByRole('button', { name: 'Remover Ana Lima' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByText('Fechar sem salvar?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('submits the draft values', async () => {
    comRascunho({ titulo: 'Pauta', participantes: ['u1'] });
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    const [payload, participantes] = criarEventoMock.mock.calls[0];
    expect(payload.titulo).toBe('Pauta');
    expect(participantes).toEqual(['u1']);
  });

  it('a new draft identity does not wipe what was typed after opening', () => {
    const onOpenChange = vi.fn();
    const ui = (rascunho: { titulo: string }) => (
      <EventoFormDialog
        open
        onOpenChange={onOpenChange}
        modo="criar"
        inicial={INICIAL}
        rascunho={rascunho}
      />
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const envolver = (el: React.ReactElement) => (
      <QueryClientProvider client={qc}>{el}</QueryClientProvider>
    );
    const { rerender } = render(envolver(ui({ titulo: 'Pauta' })));
    fireEvent.change(titulo(), { target: { value: 'Pauta editada' } });
    rerender(envolver(ui({ titulo: 'Pauta' })));
    expect(titulo().value).toBe('Pauta editada');
  });
});

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
      compartilhado_cliente: false,
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

  it('the X (Fechar) button on a dirty form asks too', async () => {
    const { onOpenChange } = criar();
    fireEvent.change(titulo(), { target: { value: 'Algo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
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
  compartilhado_cliente: false,
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

describe('EventoFormDialog: Compartilhar com o cliente', () => {
  const interruptor = () => screen.queryByRole('switch', { name: 'Compartilhar com o cliente' });

  it('shows the switch only once a cliente is picked', async () => {
    criar();
    expect(interruptor()).toBeNull();
    await screen.findByRole('option', { name: 'Clínica Sorriso' });
    fireEvent.change(select('Cliente'), { target: { value: '12' } });
    expect(interruptor()).toBeInTheDocument();
    expect(
      screen.getByText('Aparece no portal do cliente e ele recebe o convite por e-mail.'),
    ).toBeInTheDocument();
    fireEvent.change(select('Cliente'), { target: { value: 'none' } });
    expect(interruptor()).toBeNull();
  });

  it('hides when Privado is on, and turning Privado on clears it', async () => {
    criar();
    await screen.findByRole('option', { name: 'Clínica Sorriso' });
    fireEvent.change(select('Cliente'), { target: { value: '12' } });
    fireEvent.click(interruptor()!);
    expect(interruptor()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(interruptor()).toBeNull();
    // Back to public: the switch returns off, not remembered as on.
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(interruptor()).toHaveAttribute('aria-checked', 'false');
  });

  it('clears when the cliente goes back to "Sem cliente"', async () => {
    criar();
    await screen.findByRole('option', { name: 'Clínica Sorriso' });
    fireEvent.change(select('Cliente'), { target: { value: '12' } });
    fireEvent.click(interruptor()!);
    fireEvent.change(select('Cliente'), { target: { value: 'none' } });
    fireEvent.change(select('Cliente'), { target: { value: '12' } });
    expect(interruptor()).toHaveAttribute('aria-checked', 'false');
  });

  it('sends compartilhado_cliente in the create payload', async () => {
    criar();
    await screen.findByRole('option', { name: 'Clínica Sorriso' });
    fireEvent.change(titulo(), { target: { value: 'Gravação' } });
    fireEvent.change(select('Cliente'), { target: { value: '12' } });
    fireEvent.click(interruptor()!);
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    expect(criarEventoMock.mock.calls[0][0]).toMatchObject({
      cliente_id: 12,
      compartilhado_cliente: true,
    });
  });

  it('warns when the cliente has no e-mail', async () => {
    criar();
    await screen.findByRole('option', { name: 'Sem Email' });
    fireEvent.change(select('Cliente'), { target: { value: '14' } });
    expect(
      screen.getByText('Este cliente não tem e-mail cadastrado. O evento aparece só no portal.'),
    ).toBeInTheDocument();
  });

  it('says the client gets the invite by e-mail when the workspace has no Hub', async () => {
    hasFeatureMock.mockImplementation((flag: string) => flag !== 'feature_hub_portal');
    criar();
    await screen.findByRole('option', { name: 'Clínica Sorriso' });
    fireEvent.change(select('Cliente'), { target: { value: '12' } });
    expect(screen.getByText('O cliente recebe o convite por e-mail.')).toBeInTheDocument();
  });

  it('says nobody is told when there is neither e-mail nor Hub', async () => {
    hasFeatureMock.mockReturnValue(false);
    criar();
    await screen.findByRole('option', { name: 'Sem Email' });
    fireEvent.change(select('Cliente'), { target: { value: '14' } });
    expect(screen.getByText(/O cliente não será avisado deste evento\./)).toBeInTheDocument();
  });

  it('edit: starts on for a shared event; turning it off is a series change that locks "Este evento"', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG, compartilhado_cliente: true }));
    await waitFor(() => expect(select('Cliente').value).toBe('12'));
    expect(interruptor()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(interruptor()!);
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    expect(within(dlg).getByRole('radio', { name: 'Este evento' })).toBeDisabled();
    expect(
      within(dlg).getByText('Vale para toda a série: você mudou o compartilhamento com o cliente.'),
    ).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(editarEventoMock).toHaveBeenCalledWith(
        7,
        'seguintes',
        { ...SERIE, regra: SEMANAL_SEG, compartilhado_cliente: false },
        null,
      ),
    );
  });
});

describe('EventoFormDialog: convidados externos', () => {
  const campo = () => screen.getByRole('textbox', { name: 'E-mail do convidado' });
  const digitar = (valor: string) => {
    fireEvent.change(campo(), { target: { value: valor } });
    fireEvent.keyDown(campo(), { key: 'Enter' });
  };
  const AJUDA =
    'Recebem o convite por e-mail, com título, horário, local, link e descrição, e respondem por um link, sem precisar de conta.';
  const GUEST = { id: 5, email: 'ana@exemplo.com', nome: 'Ana Souza', resposta: 'sim' as const };

  it('shows the field below Participantes with the help copy and the counter', () => {
    criar();
    expect(screen.getByText('Convidados externos')).toBeInTheDocument();
    expect(screen.getByText(AJUDA)).toBeInTheDocument();
    expect(screen.getByText('0 de 20')).toBeInTheDocument();
    const participantes = screen.getByText('Participantes');
    const convidados = screen.getByText('Convidados externos');
    expect(
      participantes.compareDocumentPosition(convidados) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The label points at the text field.
    expect(screen.getByLabelText('Convidados externos')).toBe(campo());
  });

  const AVISO = 'Remova os convidados externos antes de tornar o evento privado.';
  const botaoSalvar = () => screen.getByRole('button', { name: 'Salvar' });

  it('Privado with no guests hides the field', () => {
    criar();
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(screen.queryByText('Convidados externos')).toBeNull();
    expect(screen.queryByText(AJUDA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it('Privado with guests keeps the field, warns and disables Salvar; Privado off clears the block', () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    digitar('ana@exemplo.com');
    expect(botaoSalvar()).toBeEnabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(screen.getByText('Convidados externos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover ana@exemplo.com' })).toBeInTheDocument();
    expect(screen.getByText(AVISO)).toBeInTheDocument();
    expect(botaoSalvar()).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(screen.queryByText(AVISO)).toBeNull();
    expect(botaoSalvar()).toBeEnabled();
  });

  it('removing the last chip re-enables Salvar and hides the field', () => {
    criar();
    digitar('ana@exemplo.com');
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(botaoSalvar()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remover ana@exemplo.com' }));
    expect(screen.queryByText('Convidados externos')).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
    expect(botaoSalvar()).toBeEnabled();
  });

  it('Enter in the title cannot submit a private event that still has guests', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    digitar('ana@exemplo.com');
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    fireEvent.submit(titulo().closest('form')!);
    await new Promise((r) => setTimeout(r, 50));
    expect(criarEventoMock).not.toHaveBeenCalled();
  });

  it('create: sends the guests in the payload', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    digitar('Ana@Exemplo.com');
    digitar('bia@exemplo.com');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    expect(criarEventoMock.mock.calls[0][0].convidados).toEqual([
      { email: 'ana@exemplo.com', nome: null },
      { email: 'bia@exemplo.com', nome: null },
    ]);
  });

  it('create: removing the chips of a private event sends a private event without guests', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    digitar('ana@exemplo.com');
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover ana@exemplo.com' }));
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    expect(criarEventoMock.mock.calls[0][0].privado).toBe(true);
    expect('convidados' in criarEventoMock.mock.calls[0][0]).toBe(false);
  });

  it('create: an invalid address blocks nothing but is not sent', async () => {
    criar();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    digitar('ana@exemplo');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail válido.');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    expect('convidados' in criarEventoMock.mock.calls[0][0]).toBe(false);
  });

  it('edit: pre-fills the existing guests and leaves them out of the payload when untouched', async () => {
    editar(ocorrencia({ convidados: [GUEST] }));
    expect(screen.getByRole('button', { name: 'Remover ana@exemplo.com' })).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    fireEvent.change(titulo(), { target: { value: 'Gravação: novembro' } });
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalledTimes(1));
    expect('convidados' in editarEventoMock.mock.calls[0][2]).toBe(false);
  });

  it('edit: adding a guest sends the full list', async () => {
    editar(ocorrencia({ convidados: [GUEST] }));
    digitar('bia@exemplo.com');
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalledTimes(1));
    expect(editarEventoMock.mock.calls[0][2].convidados).toEqual([
      { email: 'ana@exemplo.com', nome: 'Ana Souza' },
      { email: 'bia@exemplo.com', nome: null },
    ]);
  });

  it('edit: removing the only guest alone is a change and sends []', async () => {
    editar(ocorrencia({ convidados: [GUEST] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover ana@exemplo.com' }));
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalledTimes(1));
    expect(editarEventoMock.mock.calls[0][2].convidados).toEqual([]);
  });

  it('edit: turning Privado on with guests blocks Salvar; removing them first sends privado with []', async () => {
    editar(ocorrencia({ convidados: [GUEST] }));
    fireEvent.click(screen.getByRole('switch', { name: 'Evento privado' }));
    expect(botaoSalvar()).toBeDisabled();
    salvar();
    expect(editarEventoMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remover ana@exemplo.com' }));
    expect(botaoSalvar()).toBeEnabled();
    salvar();
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalledTimes(1));
    expect(editarEventoMock.mock.calls[0][2].privado).toBe(true);
    expect(editarEventoMock.mock.calls[0][2].convidados).toEqual([]);
  });

  it('edit of a series: changing guests locks "Este evento" and names them', async () => {
    editar(ocorrencia({ recorrente: true, regra: SEMANAL_SEG, convidados: [GUEST] }));
    digitar('bia@exemplo.com');
    salvar();
    const dlg = await screen.findByRole('alertdialog', { name: 'Editar evento recorrente' });
    expect(within(dlg).getByRole('radio', { name: 'Este evento' })).toBeDisabled();
    expect(
      within(dlg).getByText('Vale para toda a série: você mudou os convidados externos.'),
    ).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(editarEventoMock).toHaveBeenCalledTimes(1));
    expect(editarEventoMock.mock.calls[0][1]).toBe('seguintes');
    expect(editarEventoMock.mock.calls[0][2].convidados).toHaveLength(2);
  });

  it('surfaces a server guest error through the agenda formatter', async () => {
    editarEventoMock.mockRejectedValueOnce({
      message: 'agenda: ana@exemplo.com já é da equipe. Adicione como participante.',
    });
    editar(ocorrencia());
    digitar('ana@exemplo.com');
    salvar();
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Ana@exemplo.com já é da equipe. Adicione como participante.',
      ),
    );
  });
});
