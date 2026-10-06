import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { criarEventoMock, getWorkspaceUsersMock, toastMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    criarEventoMock: vi.fn(),
    getWorkspaceUsersMock: vi.fn(),
    toastMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock('@/store/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/agenda')>()),
  criarEvento: criarEventoMock,
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

// jsdom cannot drive Radix Select; a native stand-in (as in EventoFormDialog.test.tsx).
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

import { EventoRapidoCard } from '../EventoRapidoCard';

const PESSOAS = [
  { id: 'me', nome: 'Eu Mesmo', avatar_url: null },
  { id: 'u1', nome: 'Ana Lima', avatar_url: null },
];

const TERCA_9H = {
  inicio: new Date(2026, 9, 6, 9, 0),
  fim: new Date(2026, 9, 6, 10, 0),
  diaInteiro: false,
};

let anchor: HTMLElement;

beforeEach(() => {
  criarEventoMock.mockReset();
  criarEventoMock.mockResolvedValue({
    evento_id: 1,
    ocorrencia_id: 10,
    dtstart: '2026-10-06T09:00:00',
  });
  getWorkspaceUsersMock.mockResolvedValue(PESSOAS);
  toastMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  document.body.replaceChildren();
  anchor = document.createElement('div');
  anchor.dataset.ocorrenciaId = 'rascunho';
  document.body.appendChild(anchor);
});

function abrir(inicial = TERCA_9H) {
  const onClose = vi.fn();
  const onMaisOpcoes = vi.fn();
  const onRascunhoChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <EventoRapidoCard
        inicial={inicial}
        anchor={anchor}
        onClose={onClose}
        onMaisOpcoes={onMaisOpcoes}
        onRascunhoChange={onRascunhoChange}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onMaisOpcoes, onRascunhoChange };
}

const titulo = () => screen.getByLabelText('Título') as HTMLInputElement;
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

describe('EventoRapidoCard', () => {
  it('opens with the title focused and only the compact fields', async () => {
    abrir();
    expect(screen.getByRole('dialog', { name: 'Novo evento' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(titulo()));
    expect(titulo()).toHaveAttribute('placeholder', 'Adicionar título');
    expect(screen.getByRole('combobox', { name: 'Hora de início' })).toHaveValue('09:00');
    expect(screen.getByRole('combobox', { name: 'Hora de fim' })).toHaveValue('10:00');
    expect(screen.getByPlaceholderText('Adicionar local')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Não se repete' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Reunião' })).toHaveAttribute('data-state', 'on');
    expect(screen.queryByRole('combobox', { name: 'Repetir' })).toBeNull();
    expect(screen.queryByLabelText('Descrição')).toBeNull();
    expect(screen.queryByText('Lembretes')).toBeNull();
  });

  it('Salvar with an empty title shows the error and creates nothing', async () => {
    const { onClose } = abrir();
    salvar();
    expect(await screen.findByText('Informe um título.')).toBeInTheDocument();
    expect(criarEventoMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Salvar creates the event on the selected slot and closes', async () => {
    const { onClose } = abrir();
    fireEvent.change(titulo(), { target: { value: 'Reunião de pauta' } });
    fireEvent.change(screen.getByPlaceholderText('Adicionar local'), {
      target: { value: 'Sala 2' },
    });
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    const [payload, participantes] = criarEventoMock.mock.calls[0];
    expect(payload).toMatchObject({
      titulo: 'Reunião de pauta',
      tipo: 'reuniao',
      local: 'Sala 2',
      dia_inteiro: false,
      tz: 'America/Sao_Paulo',
      inicio_local: '2026-10-06T09:00:00',
      fim_local: '2026-10-06T10:00:00',
      lembretes: [10],
      regra: null,
    });
    expect(participantes).toEqual([]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastSuccessMock).toHaveBeenCalledWith('Evento criado');
  });

  it('Enter in the title submits', async () => {
    abrir();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.submit(titulo().form!);
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
  });

  it('a second Enter while the save is in flight creates nothing more', async () => {
    let resolver!: (v: unknown) => void;
    criarEventoMock.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    abrir();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.submit(titulo().form!);
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    fireEvent.submit(titulo().form!);
    fireEvent.submit(titulo().form!);
    // Let the extra submits run their async validation before checking.
    await new Promise((r) => setTimeout(r, 20));
    expect(criarEventoMock).toHaveBeenCalledTimes(1);
    resolver({ evento_id: 1, ocorrencia_id: 1, dtstart: '2026-10-06T09:00:00' });
  });

  it('picking a tipo pill changes the payload tipo', async () => {
    abrir();
    fireEvent.change(titulo(), { target: { value: 'Gravar reels' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Gravação' }));
    expect(screen.getByRole('radio', { name: 'Gravação' })).toHaveAttribute('data-state', 'on');
    // Clicking the active pill again never leaves the group empty.
    fireEvent.click(screen.getByRole('radio', { name: 'Gravação' }));
    expect(screen.getByRole('radio', { name: 'Gravação' })).toHaveAttribute('data-state', 'on');
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    expect(criarEventoMock.mock.calls[0][0].tipo).toBe('gravacao');
  });

  it('"Mais opções" and "Não se repete" hand the typed values to the full editor', () => {
    const { onMaisOpcoes, onClose } = abrir();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    expect(onMaisOpcoes).toHaveBeenCalledTimes(1);
    expect(onMaisOpcoes.mock.calls[0][0]).toMatchObject({
      titulo: 'Pauta',
      tipo: 'reuniao',
      hora_inicio: '09:00',
      hora_fim: '10:00',
      dia_inteiro: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Não se repete' }));
    expect(onMaisOpcoes).toHaveBeenCalledTimes(2);
    expect(criarEventoMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports the live draft: title, tipo and a moved time', () => {
    const { onRascunhoChange } = abrir();
    expect(onRascunhoChange).toHaveBeenLastCalledWith({
      inicio: new Date(2026, 9, 6, 9, 0),
      fim: new Date(2026, 9, 6, 10, 0),
      diaInteiro: false,
      titulo: '',
      tipo: 'reuniao',
    });

    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    expect(onRascunhoChange).toHaveBeenLastCalledWith(expect.objectContaining({ titulo: 'Pauta' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Interno' }));
    expect(onRascunhoChange).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: 'interno' }));

    // Moving the start keeps the 1 h duration.
    fireEvent.change(screen.getByRole('combobox', { name: 'Hora de início' }), {
      target: { value: '14:30' },
    });
    expect(onRascunhoChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inicio: new Date(2026, 9, 6, 14, 30),
        fim: new Date(2026, 9, 6, 15, 30),
      }),
    );
  });

  it('never reports an end before the start', () => {
    const { onRascunhoChange } = abrir();
    onRascunhoChange.mockClear();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hora de fim' }), {
      target: { value: '08:00' },
    });
    expect(onRascunhoChange).not.toHaveBeenCalled();
  });

  it('an all-day draft reports midnight to the exclusive next midnight', () => {
    const { onRascunhoChange } = abrir({
      inicio: new Date(2026, 9, 6),
      fim: new Date(2026, 9, 7),
      diaInteiro: true,
    });
    expect(onRascunhoChange).toHaveBeenLastCalledWith({
      inicio: new Date(2026, 9, 6),
      fim: new Date(2026, 9, 7),
      diaInteiro: true,
      titulo: '',
      tipo: 'reuniao',
    });
    expect(screen.queryByRole('combobox', { name: 'Hora de início' })).toBeNull();
  });

  it('opening the people combobox keeps the card open, and the person is saved', async () => {
    const { onClose } = abrir();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar pessoa da equipe/ }));
    const ana = await screen.findByRole('option', { name: /Ana Lima/ });
    // The organizer is never offered.
    expect(screen.queryByRole('option', { name: /Eu Mesmo/ })).toBeNull();
    fireEvent.click(ana);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Novo evento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover Ana Lima' })).toBeInTheDocument();
    salvar();
    await waitFor(() => expect(criarEventoMock).toHaveBeenCalledTimes(1));
    expect(criarEventoMock.mock.calls[0][1]).toEqual(['u1']);
  });

  it('X and Esc discard without asking', () => {
    const { onClose } = abrir();
    fireEvent.change(titulo(), { target: { value: 'Pauta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(titulo(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Fechar sem salvar?')).toBeNull();
  });

  it('a press outside closes it, a press on the draft chip does not', async () => {
    const { onClose } = abrir();
    // Radix registers its outside-pointer listener on the next tick.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    const fora = document.createElement('div');
    document.body.appendChild(fora);
    fireEvent.pointerDown(fora);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
