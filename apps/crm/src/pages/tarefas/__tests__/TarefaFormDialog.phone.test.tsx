import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';
import type { TarefaWithRelations } from '../../../store';

const {
  addTarefaMock,
  updateTarefaMock,
  setTarefaTagsMock,
  addTarefaTagMock,
  criarTarefaSerieMock,
  getMembrosMock,
  getClientesMock,
  getTarefasMock,
  searchPostsForMentionMock,
} = vi.hoisted(() => ({
  addTarefaMock: vi.fn(),
  updateTarefaMock: vi.fn(),
  setTarefaTagsMock: vi.fn(),
  addTarefaTagMock: vi.fn(),
  criarTarefaSerieMock: vi.fn(),
  getMembrosMock: vi.fn(),
  getClientesMock: vi.fn(),
  getTarefasMock: vi.fn(),
  searchPostsForMentionMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: updateTarefaMock,
  setTarefaTags: setTarefaTagsMock,
  addTarefaTag: addTarefaTagMock,
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getTarefas: getTarefasMock,
  criarTarefaSerie: criarTarefaSerieMock,
  aplicarEdicaoSerie: vi.fn(),
  definirEstadoSerie: vi.fn(),
  deleteTarefaSerieCompleta: vi.fn(),
  isSerieDateConflict: () => false,
  isSerieSemPrazo: () => false,
}));
vi.mock('@/store/posts', () => ({ searchPostsForMention: searchPostsForMentionMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TarefaFormDialog } from '../components/TarefaFormDialog';

const MEMBROS = [
  { id: 1, nome: 'Ana' },
  { id: 2, nome: 'Bruno' },
] as never[];
const CLIENTES = [{ id: 7, nome: 'Café Aurora', status: 'ativo' }] as never[];
const TAGS = [{ id: 3, nome: 'Urgente', cor: '#ef4444' }] as never[];

beforeEach(() => {
  getMembrosMock.mockResolvedValue([]);
  getClientesMock.mockResolvedValue([]);
  getTarefasMock.mockResolvedValue([]);
  searchPostsForMentionMock.mockResolvedValue([]);
  addTarefaMock.mockResolvedValue({ id: 99 });
  updateTarefaMock.mockResolvedValue(undefined);
  setTarefaTagsMock.mockResolvedValue(undefined);
  criarTarefaSerieMock.mockResolvedValue(undefined);
});

function renderPhone(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PhoneLayoutProvider isPhone>{ui}</PhoneLayoutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeEditing(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Tarefa',
    descricao: null,
    descricao_rich: null,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: '2099-01-05',
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    comentarios_total: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

describe('TarefaFormDialog on phones', () => {
  it('lays the fields out as grouped rows with picker rows and a native date input', async () => {
    renderPhone(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={MEMBROS}
        clientes={CLIENTES}
        tags={TAGS}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Título')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Responsável/ })).toHaveTextContent(
      'Sem responsável',
    );
    expect(within(dialog).getByRole('button', { name: /Cliente/ })).toHaveTextContent(
      'Sem cliente',
    );
    expect(within(dialog).getByLabelText('Prazo')).toHaveAttribute('type', 'date');
    expect(within(dialog).getByRole('button', { name: /Repetir/ })).toHaveTextContent('Não repete');
    expect(within(dialog).getByRole('button', { name: /Tags/ })).toHaveTextContent('Nenhuma');
    // No Radix selects on phones.
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('creates a task with the responsável, cliente and prazo picked on the phone rows', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderPhone(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={MEMBROS}
        clientes={CLIENTES}
        tags={TAGS}
        onSaved={onSaved}
        onTagCreated={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Nova tarefa' });
    await user.type(within(dialog).getByLabelText('Título'), 'Gravar bastidores');

    await user.click(within(dialog).getByRole('button', { name: /Responsável/ }));
    const membroSheet = await screen.findByRole('dialog', { name: 'Responsável' });
    await user.click(within(membroSheet).getByRole('button', { name: 'Bruno' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Responsável' })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByRole('button', { name: /Responsável/ })).toHaveTextContent('Bruno');

    await user.click(within(dialog).getByRole('button', { name: /Cliente/ }));
    const clienteSheet = await screen.findByRole('dialog', { name: 'Cliente' });
    await user.click(within(clienteSheet).getByRole('button', { name: 'Café Aurora' }));

    fireEvent.change(within(dialog).getByLabelText('Prazo'), { target: { value: '2099-03-10' } });

    await user.click(within(dialog).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(addTarefaMock).toHaveBeenCalledTimes(1));
    expect(addTarefaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        titulo: 'Gravar bastidores',
        responsavel_id: 2,
        cliente_id: 7,
        data_limite: '2099-03-10',
      }),
      [],
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows the validation message on the Título row', async () => {
    const user = userEvent.setup();
    renderPhone(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={MEMBROS}
        clientes={CLIENTES}
        tags={TAGS}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Criar tarefa' }));
    expect(await within(dialog).findByText('Informe o título da tarefa')).toBeInTheDocument();
    expect(addTarefaMock).not.toHaveBeenCalled();
  });

  it('builds a weekly series from the Repetir picker and the day chips', async () => {
    const user = userEvent.setup();
    renderPhone(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={MEMBROS}
        clientes={CLIENTES}
        tags={TAGS}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Nova tarefa' });
    await user.type(within(dialog).getByLabelText('Título'), 'Responder DMs');
    fireEvent.change(within(dialog).getByLabelText('Prazo'), { target: { value: '2099-03-09' } });

    await user.click(within(dialog).getByRole('button', { name: /Repetir/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Repetir' });
    await user.click(within(sheet).getByRole('button', { name: 'Semanalmente' }));

    const days = await within(dialog).findByRole('group', { name: 'Dias da semana' });
    await user.click(within(days).getByRole('button', { name: 'segunda' }));
    expect(within(days).getByRole('button', { name: 'segunda' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByTestId('recorrencia-resumo')).toHaveTextContent(/segunda/);

    await user.click(within(dialog).getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(criarTarefaSerieMock).toHaveBeenCalledTimes(1));
    const [regra, payload] = criarTarefaSerieMock.mock.calls[0];
    expect(regra).toEqual(expect.objectContaining({ freq: 'weekly', dias_semana: [1] }));
    expect(payload).toEqual(expect.objectContaining({ titulo: 'Responder DMs' }));
  });

  it('picks tags in the tags sheet and saves them with the edit', async () => {
    const user = userEvent.setup();
    renderPhone(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={makeEditing()}
        membros={MEMBROS}
        clientes={CLIENTES}
        tags={TAGS}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar tarefa' });
    // Editing shows the status row.
    expect(within(dialog).getByRole('button', { name: /Status/ })).toHaveTextContent('A fazer');

    await user.click(within(dialog).getByRole('button', { name: /Tags/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Tags' });
    await user.click(within(sheet).getByRole('button', { name: 'Urgente' }));
    await user.click(within(sheet).getByRole('button', { name: 'Fechar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Tags' })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByRole('button', { name: /Tags/ })).toHaveTextContent('Urgente');

    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(setTarefaTagsMock).toHaveBeenCalledWith(42, [3]));
  });
});
