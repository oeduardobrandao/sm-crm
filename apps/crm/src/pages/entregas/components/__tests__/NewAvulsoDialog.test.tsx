import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import type { Cliente } from '@/store';

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement --
// same stubs used by MigrateTemplateDialog.test.tsx / EquipePage.test.tsx.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { createAvulsoPostMock, applyPostProcessMock, toastSuccessMock, toastErrorMock } = vi.hoisted(
  () => ({
    createAvulsoPostMock: vi.fn(),
    applyPostProcessMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock('@/store', () => ({
  createAvulsoPost: createAvulsoPostMock,
  applyPostProcess: applyPostProcessMock,
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import type { WorkflowTemplate } from '@/store';
import { NewAvulsoDialog } from '../NewAvulsoDialog';

const CLIENTES: Cliente[] = [
  { id: 7, nome: 'Clínica Aurora', status: 'ativo' } as Cliente,
  { id: 8, nome: 'Cliente Encerrado', status: 'encerrado' } as Cliente,
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof NewAvulsoDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <NewAvulsoDialog
        open
        onClose={onClose}
        clientes={CLIENTES}
        onCreated={onCreated}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onCreated, invalidateSpy };
}

async function selectCliente(nome: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Cliente' }));
  fireEvent.click(await screen.findByRole('option', { name: nome }));
}

beforeEach(() => {
  createAvulsoPostMock.mockReset();
  applyPostProcessMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

const PADRAO_TEMPLATE: WorkflowTemplate = {
  id: 3,
  nome: 'Redes',
  modo_prazo: 'padrao',
  etapas: [{ nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao' } as never],
};

const DATA_FIXA_TEMPLATE: WorkflowTemplate = {
  id: 4,
  nome: 'Mensal',
  modo_prazo: 'data_fixa',
  etapas: [{ nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao' } as never],
};

describe('NewAvulsoDialog', () => {
  it('only offers active clientes', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('combobox', { name: 'Cliente' }));
    expect(await screen.findByRole('option', { name: 'Clínica Aurora' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cliente Encerrado' })).not.toBeInTheDocument();
  });

  it('does not submit without a cliente selected', async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Título do post'), {
      target: { value: 'Post sem cliente' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() => expect(screen.getByText('Selecione um cliente')).toBeInTheDocument());
    expect(createAvulsoPostMock).not.toHaveBeenCalled();
  });

  it('creates the post, toasts, invalidates active-posts, and hands the post to onCreated', async () => {
    const created = { id: 55, cliente_id: 7, titulo: 'Story do dia', tipo: 'stories' };
    createAvulsoPostMock.mockResolvedValue(created);
    const { onClose, onCreated, invalidateSpy } = renderDialog();

    await selectCliente('Clínica Aurora');
    fireEvent.change(screen.getByPlaceholderText('Título do post'), {
      target: { value: 'Story do dia' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: 'Tipo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Stories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() => expect(createAvulsoPostMock).toHaveBeenCalledTimes(1));
    expect(createAvulsoPostMock).toHaveBeenCalledWith({
      cliente_id: 7,
      titulo: 'Story do dia',
      tipo: 'stories',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Post avulso criado');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['active-posts'] });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defaults tipo to feed when left untouched', async () => {
    createAvulsoPostMock.mockResolvedValue({ id: 1, cliente_id: 7, titulo: 'X', tipo: 'feed' });
    renderDialog();
    await selectCliente('Clínica Aurora');
    fireEvent.change(screen.getByPlaceholderText('Título do post'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() =>
      expect(createAvulsoPostMock).toHaveBeenCalledWith({
        cliente_id: 7,
        titulo: 'X',
        tipo: 'feed',
      }),
    );
  });

  it('shows a generic error toast and does not close on failure', async () => {
    createAvulsoPostMock.mockRejectedValue(new Error('duplicate key value violates constraint'));
    const { onClose, onCreated } = renderDialog();

    await selectCliente('Clínica Aurora');
    fireEvent.change(screen.getByPlaceholderText('Título do post'), {
      target: { value: 'Vai falhar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Erro ao criar post avulso'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without creating anything', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createAvulsoPostMock).not.toHaveBeenCalled();
  });

  // Spec §3, "+ Novo ▾" da coluna: quando o dialog abre com um template
  // pré-vinculado (templateId + templates), o submit tenta aplicar o
  // processo automaticamente em vez de só criar o post avulso.
  describe('com templateId (quick-add "Post individual")', () => {
    async function createPost(overrides: Partial<React.ComponentProps<typeof NewAvulsoDialog>>) {
      const created = { id: 55, cliente_id: 7, titulo: 'Story do dia', tipo: 'stories' };
      createAvulsoPostMock.mockResolvedValue(created);
      const utils = renderDialog(overrides);
      await selectCliente('Clínica Aurora');
      fireEvent.change(screen.getByPlaceholderText('Título do post'), {
        target: { value: 'Story do dia' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));
      await waitFor(() => expect(createAvulsoPostMock).toHaveBeenCalledTimes(1));
      return { ...utils, created };
    }

    it('modo_prazo padrao: applies the process, invalidates the process query keys, and still calls onCreated', async () => {
      applyPostProcessMock.mockResolvedValue({ ok: true, process_id: 1, post_id: 55 });
      const { onCreated, onClose, invalidateSpy, created } = await createPost({
        templateId: PADRAO_TEMPLATE.id,
        templates: [PADRAO_TEMPLATE],
      });

      await waitFor(() => expect(applyPostProcessMock).toHaveBeenCalledTimes(1));
      expect(applyPostProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: 55,
          templateId: PADRAO_TEMPLATE.id,
          startOrdem: 0,
        }),
      );
      for (const key of [
        ['post-processes'],
        ['post-process', 55],
        ['post-process-events'],
        ['active-posts'],
        ['standalone-post', 55],
      ]) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key });
      }
      expect(onCreated).toHaveBeenCalledWith(created);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('modo_prazo != padrao: skips auto-apply and hands off to onNeedsManualApply instead of onCreated', async () => {
      const onNeedsManualApply = vi.fn();
      const { onCreated, onClose, created } = await createPost({
        templateId: DATA_FIXA_TEMPLATE.id,
        templates: [DATA_FIXA_TEMPLATE],
        onNeedsManualApply,
      });

      expect(applyPostProcessMock).not.toHaveBeenCalled();
      expect(onNeedsManualApply).toHaveBeenCalledWith(created, DATA_FIXA_TEMPLATE);
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Sucesso e falha do auto-apply têm destinos diferentes: com processo o
    // quadro de Fluxos revela o card (onProcessApplied); sem processo é o
    // drawer de avulso de onCreated (spec §3).
    it('modo_prazo padrao: a successful auto-apply routes to onProcessApplied, not onCreated', async () => {
      applyPostProcessMock.mockResolvedValue({ ok: true, process_id: 1, post_id: 55 });
      const onProcessApplied = vi.fn();
      const { onCreated, created } = await createPost({
        templateId: PADRAO_TEMPLATE.id,
        templates: [PADRAO_TEMPLATE],
        onProcessApplied,
      });

      await waitFor(() => expect(onProcessApplied).toHaveBeenCalledWith(created));
      expect(onCreated).not.toHaveBeenCalled();
    });

    it('a failed auto-apply falls back to onCreated even with onProcessApplied wired', async () => {
      applyPostProcessMock.mockRejectedValue(new Error('template_changed'));
      const onProcessApplied = vi.fn();
      const { onCreated, created } = await createPost({
        templateId: PADRAO_TEMPLATE.id,
        templates: [PADRAO_TEMPLATE],
        onProcessApplied,
      });

      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
      expect(onProcessApplied).not.toHaveBeenCalled();
    });

    it('modo_prazo != padrao sem onNeedsManualApply: cai em onCreated em vez de sumir com o post', async () => {
      const { onCreated, created } = await createPost({
        templateId: DATA_FIXA_TEMPLATE.id,
        templates: [DATA_FIXA_TEMPLATE],
      });

      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
      expect(applyPostProcessMock).not.toHaveBeenCalled();
    });

    it('a failed auto-apply still creates the post and calls onCreated', async () => {
      applyPostProcessMock.mockRejectedValue(new Error('template_changed'));
      const { onCreated, onClose, created } = await createPost({
        templateId: PADRAO_TEMPLATE.id,
        templates: [PADRAO_TEMPLATE],
      });

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
      expect(onCreated).toHaveBeenCalledWith(created);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
