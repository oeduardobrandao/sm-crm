import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  detachPostsFromWorkflow: vi.fn(),
  detachPostsKeepingProcess: vi.fn(),
}));
vi.mock('../../../../store', () => store);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { DetachPostsDialog, keepStepsAvailability } from '../DetachPostsDialog';
import type { BoardCard } from '../../hooks/useEntregasData';

const etapas = [
  {
    id: 1,
    workflow_id: 11,
    ordem: 0,
    nome: 'Copy',
    tipo: 'padrao',
    status: 'concluido',
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    iniciado_em: '2026-09-01T12:00:00Z',
    data_limite: null,
  },
  {
    id: 2,
    workflow_id: 11,
    ordem: 1,
    nome: 'Design',
    tipo: 'padrao',
    status: 'ativo',
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    iniciado_em: '2026-09-10T12:00:00Z',
    data_limite: null,
  },
  {
    id: 3,
    workflow_id: 11,
    ordem: 2,
    nome: 'Aprovação',
    tipo: 'aprovacao_cliente',
    status: 'pendente',
    prazo_dias: 1,
    tipo_prazo: 'corridos',
    iniciado_em: null,
    data_limite: '2026-09-20',
  },
] as never[];
const card = {
  workflow: {
    id: 11,
    titulo: 'Conteúdo de setembro',
    status: 'ativo',
    etapa_atual: 1,
    cliente_id: 4,
    template_id: 3,
  },
  etapa: etapas[1],
  allEtapas: etapas,
  cliente: { id: 4, nome: 'Aurora' },
  etapaIdx: 1,
  totalEtapas: 3,
} as unknown as BoardCard;
const posts = [
  { id: 7, titulo: 'Post A' },
  { id: 3, titulo: 'Post B' },
];

function renderDialog(over: Partial<React.ComponentProps<typeof DetachPostsDialog>> = {}) {
  const onDetachedWithoutProcess = vi.fn();
  const onDetachedKeepingProcess = vi.fn();
  const onClose = vi.fn();
  render(
    <DetachPostsDialog
      open
      onClose={onClose}
      card={card}
      posts={posts}
      isTotalSelection={false}
      keepStepsEnabled
      onDetachedWithoutProcess={onDetachedWithoutProcess}
      onDetachedKeepingProcess={onDetachedKeepingProcess}
      {...over}
    />,
  );
  return { onDetachedWithoutProcess, onDetachedKeepingProcess, onClose };
}

beforeEach(() => vi.clearAllMocks());

describe('DetachPostsDialog', () => {
  it('flag desligada: o AlertDialog de hoje, sem opções (DOM da fase 3)', () => {
    renderDialog({ keepStepsEnabled: false });
    expect(screen.getByText('Desmembrar do fluxo?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Manter etapas')).toBeNull();
    expect(screen.getByText(/viram publicações avulsas de Aurora/)).toBeInTheDocument();
  });
  it('flag ligada: Manter etapas pré-selecionada, lista os posts e a etapa atual', () => {
    renderDialog();
    expect(screen.getByLabelText('Manter etapas')).toBeChecked();
    expect(screen.getByLabelText('Transformar em avulso sem etapas')).not.toBeChecked();
    expect(screen.getByText('Post A')).toBeInTheDocument();
    expect(screen.getByText(/etapa atual: Design/)).toBeInTheDocument();
    expect(screen.getByText(/Status, conteúdo e aprovações são preservados/)).toBeInTheDocument();
  });
  it('Manter etapas: envia fingerprint, prazo congelado, mapa de prazos futuros e request_id estável', async () => {
    store.detachPostsKeepingProcess.mockResolvedValue({
      ok: true,
      detached: 2,
      archived_workflow_ids: [],
      processes: [],
      steps: [],
    });
    const { onDetachedKeepingProcess } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(1));
    const args = store.detachPostsKeepingProcess.mock.calls[0][0];
    expect(args.postIds).toEqual([7, 3]);
    expect(args.workflowId).toBe(11);
    expect(args.fingerprint.startsWith('etapa_atual=1\n')).toBe(true);
    expect(args.activeDeadline).toBe(new Date('2026-09-12T12:00:00Z').toISOString());
    expect(args.stepDeadlines).toEqual({
      '2': new Date(2026, 8, 20, 23, 59, 59, 999).toISOString(),
    });
    expect(args.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.archiveEmptyFlow).toBe(false);
    expect(onDetachedKeepingProcess).toHaveBeenCalledWith(
      expect.objectContaining({ detached: 2 }),
      false,
    );
  });
  it('mudar o checkbox de arquivar troca o request_id (input_hash do servidor)', async () => {
    // O harness mantém open=true, então dois envios bem-sucedidos são observáveis.
    store.detachPostsKeepingProcess.mockResolvedValue({
      ok: true,
      detached: 2,
      archived_workflow_ids: [],
      processes: [],
      steps: [],
    });
    renderDialog({ isTotalSelection: true });
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(1));
    const first = store.detachPostsKeepingProcess.mock.calls[0][0].requestId;
    fireEvent.click(screen.getByLabelText('Arquivar o fluxo depois de desmembrar'));
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(2));
    expect(store.detachPostsKeepingProcess.mock.calls[1][0].requestId).not.toBe(first);
    expect(store.detachPostsKeepingProcess.mock.calls[1][0].archiveEmptyFlow).toBe(true);
  });
  it('falha na RPC regenera o request_id para a próxima tentativa', async () => {
    store.detachPostsKeepingProcess
      .mockRejectedValueOnce({ message: 'workflow_changed', code: 'P0001' })
      .mockResolvedValueOnce({
        ok: true,
        detached: 2,
        archived_workflow_ids: [],
        processes: [],
        steps: [],
      });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'O fluxo foi alterado em outro lugar. Recarregue e tente de novo.',
      ),
    );
    const first = store.detachPostsKeepingProcess.mock.calls[0][0].requestId;
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(2));
    expect(store.detachPostsKeepingProcess.mock.calls[1][0].requestId).not.toBe(first);
  });
  it('Transformar em avulso: caminho antigo, sem processo', async () => {
    store.detachPostsFromWorkflow.mockResolvedValue({
      ok: true,
      detached: 2,
      archived_workflow_ids: [],
    });
    const { onDetachedWithoutProcess } = renderDialog();
    fireEvent.click(screen.getByLabelText('Transformar em avulso sem etapas'));
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsFromWorkflow).toHaveBeenCalledWith([7, 3], false));
    expect(store.detachPostsKeepingProcess).not.toHaveBeenCalled();
    expect(onDetachedWithoutProcess).toHaveBeenCalled();
  });
  it('fluxo não ativo ou etapas inconsistentes: só a opção sem etapas, com explicação', () => {
    renderDialog({
      card: { ...card, workflow: { ...card.workflow, status: 'concluido' } } as never,
    });
    expect(screen.getByLabelText('Manter etapas')).toBeDisabled();
    expect(screen.getByText(/Um processo pode ser aplicado depois/)).toBeInTheDocument();
    expect(screen.getByLabelText('Transformar em avulso sem etapas')).toBeChecked();
  });
});

describe('keepStepsAvailability', () => {
  it('exige fluxo ativo, exatamente uma etapa ativa e prazo calculável', () => {
    expect(keepStepsAvailability(card, '2026-09-12T12:00:00.000Z')).toEqual({ available: true });
    expect(keepStepsAvailability(card, null).available).toBe(false);
    const twoActive = {
      ...card,
      allEtapas: [etapas[1], { ...etapas[2], status: 'ativo' }],
    } as never;
    expect(keepStepsAvailability(twoActive, 'x').available).toBe(false);
  });
});
