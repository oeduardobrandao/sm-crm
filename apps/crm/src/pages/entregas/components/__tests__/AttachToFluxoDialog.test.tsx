import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getWorkflowsMock, attachPostToWorkflowMock, toastSuccessMock, toastErrorMock } = vi.hoisted(
  () => ({
    getWorkflowsMock: vi.fn(),
    attachPostToWorkflowMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock('@/store', () => ({
  getWorkflows: getWorkflowsMock,
  attachPostToWorkflow: attachPostToWorkflowMock,
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import { AttachToFluxoDialog } from '../AttachToFluxoDialog';

const WORKFLOWS = [
  { id: 1, titulo: 'Fluxo Ativo A', cliente_id: 42, status: 'ativo' },
  { id: 2, titulo: 'Fluxo Ativo B', cliente_id: 42, status: 'ativo' },
  { id: 3, titulo: 'Fluxo Arquivado', cliente_id: 42, status: 'arquivado' },
  { id: 4, titulo: 'Fluxo de outro cliente', cliente_id: 99, status: 'ativo' },
];

function renderDialog(overrides: Partial<Record<string, unknown>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const onClose = vi.fn();
  const onAttached = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AttachToFluxoDialog
        open
        onClose={onClose}
        postId={5}
        clienteId={42}
        onAttached={onAttached}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onAttached, invalidateSpy };
}

beforeEach(() => {
  getWorkflowsMock.mockReset();
  attachPostToWorkflowMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  getWorkflowsMock.mockResolvedValue(WORKFLOWS);
});

describe('AttachToFluxoDialog', () => {
  it('lists only active fluxos of the same cliente', async () => {
    renderDialog();

    expect(await screen.findByRole('radio', { name: 'Fluxo Ativo A' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Fluxo Ativo B' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Fluxo Arquivado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Fluxo de outro cliente' })).not.toBeInTheDocument();
  });

  it('shows the empty state when the cliente has no active fluxos', async () => {
    getWorkflowsMock.mockResolvedValue([
      { id: 3, titulo: 'Fluxo Arquivado', cliente_id: 42, status: 'arquivado' },
    ]);
    renderDialog();

    expect(await screen.findByText('Nenhum fluxo ativo para este cliente')).toBeInTheDocument();
  });

  it('disables the confirm button until a fluxo is selected', async () => {
    renderDialog();
    await screen.findByRole('radio', { name: 'Fluxo Ativo A' });

    expect(screen.getByRole('button', { name: 'Vincular' })).toBeDisabled();
  });

  it('attaches the post, toasts, invalidates the right caches, and calls onAttached', async () => {
    attachPostToWorkflowMock.mockResolvedValue({ ok: true, attached: 1 });
    const { onClose, onAttached, invalidateSpy } = renderDialog();

    fireEvent.click(await screen.findByRole('radio', { name: 'Fluxo Ativo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() => expect(attachPostToWorkflowMock).toHaveBeenCalledWith(5, 1));
    expect(toastSuccessMock).toHaveBeenCalledWith('Post vinculado a "Fluxo Ativo A"');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['active-posts'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['workflow-posts-with-props', 1],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-posts-counts'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientePosts', 42] });
    expect(onAttached).toHaveBeenCalledWith(1, 5);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('maps workflow_not_active to a friendly PT toast and keeps the dialog open', async () => {
    attachPostToWorkflowMock.mockRejectedValue({ message: 'workflow_not_active' });
    const { onClose, onAttached } = renderDialog();

    fireEvent.click(await screen.findByRole('radio', { name: 'Fluxo Ativo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Este fluxo não está mais ativo. Escolha outro fluxo.',
      ),
    );
    expect(onAttached).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps post_belongs_to_another_client to a friendly PT toast', async () => {
    attachPostToWorkflowMock.mockRejectedValue({ message: 'post_belongs_to_another_client' });
    renderDialog();

    fireEvent.click(await screen.findByRole('radio', { name: 'Fluxo Ativo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Este post pertence a outro cliente.'),
    );
  });

  it('maps plan_limit_exceeded:max_posts_per_workflow to a friendly PT toast', async () => {
    attachPostToWorkflowMock.mockRejectedValue({
      message: 'plan_limit_exceeded:max_posts_per_workflow',
    });
    renderDialog();

    fireEvent.click(await screen.findByRole('radio', { name: 'Fluxo Ativo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Limite de posts por fluxo do plano atual atingido.',
      ),
    );
  });

  it('falls back to a generic toast for an unrecognized error', async () => {
    attachPostToWorkflowMock.mockRejectedValue({ message: 'some_other_identifier' });
    renderDialog();

    fireEvent.click(await screen.findByRole('radio', { name: 'Fluxo Ativo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Erro ao vincular post ao fluxo'),
    );
  });

  it('cancels without attaching anything', async () => {
    const { onClose } = renderDialog();
    await screen.findByRole('radio', { name: 'Fluxo Ativo A' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(attachPostToWorkflowMock).not.toHaveBeenCalled();
  });
});
