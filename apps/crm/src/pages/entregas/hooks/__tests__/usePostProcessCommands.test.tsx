import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
}));
vi.mock('../../../../store', () => store);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { usePostProcessCommands } from '../usePostProcessCommands';
import type { ProcessTarget } from '../../postProcessCommands';

const step = (ordem: number, estado: string, tipo = 'padrao', extra = {}) =>
  ({
    id: ordem + 1,
    process_id: 5,
    ordem,
    nome: `E${ordem}`,
    tipo,
    estado,
    responsavel_id: null,
    prazo_dias: null,
    tipo_prazo: null,
    prazo_efetivo: null,
    iniciado_em: null,
    ...extra,
  }) as never;
function target(steps: unknown[], status: string, etapa_atual = 1): ProcessTarget {
  return {
    process: { id: 5, post_id: 77, estado: 'ativo', etapa_atual, revisao: 3, steps } as never,
    post: { id: 77, titulo: 'Post X', status, cliente_id: 9 },
  };
}

function Harness({
  t,
  onRefresh,
  onOptimisticStep,
}: {
  t: ProcessTarget;
  onRefresh: () => void;
  onOptimisticStep?: (id: number, o: number | null) => void;
}) {
  const c = usePostProcessCommands({ onRefresh, onOptimisticStep });
  return (
    <>
      <button onClick={() => c.avancar(t)}>avancar</button>
      <button onClick={() => c.voltar(t)}>voltar</button>
      <button onClick={() => c.concluir(t)}>concluir</button>
      <button onClick={() => c.reabrir(t)}>reabrir</button>
      <button onClick={() => c.remover(t)}>remover</button>
      {c.dialogs}
    </>
  );
}
function renderHarness(
  t: ProcessTarget,
  onOptimisticStep?: (id: number, o: number | null) => void,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onRefresh = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <Harness t={t} onRefresh={onRefresh} onOptimisticStep={onOptimisticStep} />
    </QueryClientProvider>,
  );
  return { onRefresh, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.transitionPostProcess.mockResolvedValue({
    ok: true,
    revisao: 4,
    post_status: 'rascunho',
    post_status_changed: false,
    steps: [],
  });
  store.removePostProcess.mockResolvedValue({ ok: true });
  store.updateWorkflowPost.mockResolvedValue({});
});

describe('usePostProcessCommands', () => {
  it('avançar etapa padrão: confirma, calcula p_next_deadline e não manda campos de aprovação', async () => {
    const t = target(
      [
        step(0, 'concluido'),
        step(1, 'ativo'),
        step(2, 'pendente', 'padrao', { prazo_dias: 2, tipo_prazo: 'corridos' }),
      ],
      'rascunho',
    );
    const optimistic = vi.fn();
    const { onRefresh } = renderHarness(t, optimistic);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    const args = store.transitionPostProcess.mock.calls[0][0];
    expect(args).toMatchObject({
      processId: 5,
      expectedRevisao: 3,
      command: 'avancar',
      approvalChoice: null,
      expectedPostStatus: null,
    });
    expect(typeof args.nextDeadline).toBe('string');
    expect(optimistic).toHaveBeenCalledWith(5, 2);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Etapa avançada.');
  });

  it('avançar em aprovação com post não liberado abre a escolha; "Aprovar internamente" manda aprovar_interno + status esperado', async () => {
    const t = target(
      [step(0, 'concluido'), step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente')],
      'enviado_cliente',
    );
    renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar internamente' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      command: 'avancar',
      approvalChoice: 'aprovar_interno',
      expectedPostStatus: 'enviado_cliente',
    });
  });

  it('"Enviar ao portal" desabilitado fora de aprovado_interno; habilitado faz o UPDATE direto e NÃO transiciona', async () => {
    const t = target([step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente')], 'rascunho');
    renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    expect(
      await screen.findByRole('button', { name: 'Enviar ao portal do cliente' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Só posts aprovados internamente podem ser enviados ao cliente.'),
    ).toBeInTheDocument();
  });
  it('"Enviar ao portal" com aprovado_interno', async () => {
    const t = target(
      [step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente')],
      'aprovado_interno',
    );
    const { onRefresh } = renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar ao portal do cliente' }));
    await waitFor(() =>
      expect(store.updateWorkflowPost).toHaveBeenCalledWith(77, { status: 'enviado_cliente' }),
    );
    expect(store.transitionPostProcess).not.toHaveBeenCalled();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('avançar liberado com outra aprovação PENDENTE adiante: avança direto e avisa o re-arm quando o post volta a rascunho', async () => {
    store.transitionPostProcess.mockResolvedValueOnce({
      ok: true,
      revisao: 4,
      post_status: 'rascunho',
      post_status_changed: true,
      steps: [],
    });
    const t = target(
      [step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente', 'aprovacao_cliente')],
      'aprovado_cliente',
    );
    renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Aprovar internamente' })).toBeNull();
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      approvalChoice: null,
      expectedPostStatus: 'aprovado_cliente',
    });
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        'O post voltou para rascunho para o próximo ciclo de aprovação.',
      ),
    );
  });

  it('rollback: RPC falha com process_changed → overlay desfeito, toast mapeado, refetch, sem sucesso', async () => {
    store.transitionPostProcess.mockRejectedValueOnce({
      message: 'process_changed',
      code: 'P0001',
    });
    const t = target([step(1, 'ativo'), step(2, 'pendente')], 'rascunho');
    const optimistic = vi.fn();
    const { onRefresh } = renderHarness(t, optimistic);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Este processo foi alterado em outro lugar. Recarregue e tente de novo.',
      ),
    );
    expect(optimistic).toHaveBeenLastCalledWith(5, null);
    expect(onRefresh).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('voltar: confirma e manda o comando sem prazo', async () => {
    const t = target([step(0, 'concluido'), step(1, 'ativo')], 'rascunho');
    renderHarness(t);
    fireEvent.click(screen.getByText('voltar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reverter' }));
    await waitFor(() =>
      expect(store.transitionPostProcess).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'voltar', nextDeadline: null }),
      ),
    );
  });

  it('concluir em aprovação com pendência abre a escolha SEM aviso de re-arm e com rótulo "Concluir sem alterar o post"', async () => {
    const t = target(
      [step(0, 'concluido'), step(1, 'ativo', 'aprovacao_cliente')],
      'enviado_cliente',
    );
    renderHarness(t);
    fireEvent.click(screen.getByText('concluir'));
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir sem alterar o post' }));
    await waitFor(() =>
      expect(store.transitionPostProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'concluir',
          approvalChoice: 'sem_alterar',
          expectedPostStatus: 'enviado_cliente',
        }),
      ),
    );
    expect(screen.queryByText(/voltará para rascunho/)).toBeNull();
  });

  it('reabrir e remover confirmam e chamam as RPCs certas', async () => {
    const t = target([step(0, 'concluido')], 'postado');
    t.process = { ...t.process, estado: 'concluido' } as never;
    renderHarness(t);
    fireEvent.click(screen.getByText('reabrir'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() =>
      expect(store.transitionPostProcess).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'reabrir' }),
      ),
    );
    fireEvent.click(screen.getByText('remover'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(store.removePostProcess).toHaveBeenCalledWith(5, 3));
    expect(toast.success).toHaveBeenLastCalledWith(
      'Processo removido. O post continua em Publicações.',
    );
  });
});
