import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';
import type { TarefaWithRelations } from '../../../store';

const {
  deleteTarefaMock,
  deleteSerieMock,
  definirEstadoMock,
  getSubtarefasMock,
  addSubtarefaMock,
  toggleSubtarefaMock,
  updateTarefaMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  deleteTarefaMock: vi.fn(),
  deleteSerieMock: vi.fn(),
  definirEstadoMock: vi.fn(),
  getSubtarefasMock: vi.fn(),
  addSubtarefaMock: vi.fn(),
  toggleSubtarefaMock: vi.fn(),
  updateTarefaMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return {
    ...actual,
    deleteTarefa: deleteTarefaMock,
    deleteTarefaSerieCompleta: deleteSerieMock,
    definirEstadoSerie: definirEstadoMock,
    getSubtarefas: getSubtarefasMock,
    addSubtarefa: addSubtarefaMock,
    toggleSubtarefa: toggleSubtarefaMock,
    deleteSubtarefa: vi.fn(),
    updateTarefa: updateTarefaMock,
  };
});
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: vi.fn() } }));

import { TarefaDetailSheet } from '../components/TarefaDetailSheet';

const SERIE = {
  id: 9,
  freq: 'weekly' as const,
  intervalo: 1,
  dias_semana: [1],
  dia_mes: null,
  mes: null,
  modo: 'ao_concluir' as const,
  fim: null,
  inicio: '2026-01-05',
  pausada: false,
  encerrada_em: null,
  proxima_data: null,
};

const MEMBROS = [
  { id: 1, nome: 'Ana' },
  { id: 2, nome: 'Bruno' },
] as never[];

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Responder DMs da semana',
    descricao: 'Marcar as dúvidas frequentes.',
    descricao_rich: null,
    status: 'pendente',
    responsavel_id: 1,
    cliente_id: 3,
    data_limite: '2099-01-12',
    concluida_em: null,
    created_at: '2026-01-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: 'Pet Feliz',
    cliente_cor: '#22c55e',
    serie: null,
    ...overrides,
  };
}

function renderScreen(
  tarefa: TarefaWithRelations,
  { onClose = vi.fn(), onEdit = vi.fn(), onRefresh = vi.fn(), open = true } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PhoneLayoutProvider isPhone>
          <TarefaDetailSheet
            open={open}
            tarefa={tarefa}
            membros={MEMBROS}
            onClose={onClose}
            onEdit={onEdit}
            onRefresh={onRefresh}
          />
        </PhoneLayoutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onEdit, onRefresh };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSubtarefasMock.mockResolvedValue([
    { id: 1, tarefa_id: 42, titulo: 'Ler DMs', concluida: true, ordem: 0 },
    { id: 2, tarefa_id: 42, titulo: 'Enviar resumo', concluida: false, ordem: 1 },
  ]);
  deleteTarefaMock.mockResolvedValue(undefined);
  deleteSerieMock.mockResolvedValue(undefined);
  definirEstadoMock.mockResolvedValue(undefined);
  addSubtarefaMock.mockResolvedValue(undefined);
  toggleSubtarefaMock.mockResolvedValue(undefined);
  updateTarefaMock.mockResolvedValue(undefined);
});

describe('TarefaDetailSheet on phones (pushed screen)', () => {
  it('renders a full-screen region, not a dialog, with the nav bar and grouped rows', async () => {
    renderScreen(makeTarefa());
    const region = screen.getByRole('region', { name: 'Tarefa: Responder DMs da semana' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(region).getByRole('heading', { name: 'Responder DMs da semana' })).toBeVisible();
    expect(within(region).getByRole('button', { name: 'Voltar para Tarefas' })).toBeVisible();
    expect(within(region).getByRole('button', { name: 'Editar' })).toBeVisible();
    expect(within(region).getByRole('radiogroup', { name: 'Status da tarefa' })).toBeVisible();
    expect(within(region).getByRole('button', { name: /Responsável/ })).toHaveTextContent('Ana');
    expect(within(region).getByText('Pet Feliz')).toBeVisible();
    expect(await within(region).findByText('Enviar resumo')).toBeVisible();
    expect(within(region).getByText('Subtarefas · 1/2')).toBeVisible();
  });

  it('renders nothing while closed', () => {
    renderScreen(makeTarefa(), { open: false });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('Voltar and Editar call the page handlers', async () => {
    const user = userEvent.setup();
    const { onClose, onEdit } = renderScreen(makeTarefa());
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(onEdit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Voltar para Tarefas' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('changes the status from the segmented control', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderScreen(makeTarefa());
    await user.click(screen.getByRole('radio', { name: 'Em andamento' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(42, { status: 'em_andamento' }),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it('reassigns from the Responsável picker row', async () => {
    const user = userEvent.setup();
    renderScreen(makeTarefa());
    await user.click(screen.getByRole('button', { name: /Responsável/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Responsável' });
    await user.click(within(sheet).getByRole('button', { name: 'Bruno' }));
    await waitFor(() => expect(updateTarefaMock).toHaveBeenCalledWith(42, { responsavel_id: 2 }));
  });

  it('reschedules from the Prazo row', async () => {
    const user = userEvent.setup();
    renderScreen(makeTarefa());
    await user.click(screen.getByRole('button', { name: /Prazo/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Prazo' });
    fireEvent.change(within(sheet).getByLabelText('Prazo'), { target: { value: '2099-02-01' } });
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(42, { data_limite: '2099-02-01' }),
    );
  });

  it('adds and toggles subtarefas', async () => {
    const user = userEvent.setup();
    renderScreen(makeTarefa());
    await screen.findByText('Enviar resumo');
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Enviar resumo' }));
    await waitFor(() => expect(toggleSubtarefaMock).toHaveBeenCalledWith(2, true));
    const add = screen.getByRole('button', { name: 'Adicionar subtarefa' });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText('Nova subtarefa'), 'Postar resposta');
    await user.click(add);
    await waitFor(() =>
      expect(addSubtarefaMock).toHaveBeenCalledWith(
        expect.objectContaining({ tarefa_id: 42, titulo: 'Postar resposta', ordem: 2 }),
      ),
    );
  });

  it('series: Pausar runs at once, Encerrar asks first through an action sheet', async () => {
    const user = userEvent.setup();
    renderScreen(makeTarefa({ serie: SERIE }));
    expect(screen.getByText(/Repete: Toda segunda/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Pausar série' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'pausar'));

    await user.click(screen.getByRole('button', { name: 'Encerrar série' }));
    const sheet = await screen.findByRole('dialog', { name: 'Encerrar série?' });
    expect(definirEstadoMock).not.toHaveBeenCalledWith(9, 'encerrar');
    await user.click(within(sheet).getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'encerrar'));
  });

  it('Excluir on an occurrence offers the series scope; Toda a série deletes the series', async () => {
    const user = userEvent.setup();
    const { onClose } = renderScreen(makeTarefa({ serie: SERIE }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const sheet = await screen.findByRole('dialog', { name: 'Excluir tarefa recorrente?' });
    expect(
      within(sheet).getByRole('button', { name: /^Somente esta.*criada normalmente/ }),
    ).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: /^Toda a série/ }));
    await waitFor(() => expect(deleteSerieMock).toHaveBeenCalledWith(9));
    expect(deleteTarefaMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith('Série excluída!');
    expect(onClose).toHaveBeenCalled();
  });

  it('Excluir on a standalone task asks once and deletes it', async () => {
    const user = userEvent.setup();
    renderScreen(makeTarefa());
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const sheet = await screen.findByRole('dialog', { name: 'Excluir tarefa?' });
    await user.click(within(sheet).getByRole('button', { name: 'Excluir tarefa' }));
    await waitFor(() => expect(deleteTarefaMock).toHaveBeenCalledWith(42));
  });
});
