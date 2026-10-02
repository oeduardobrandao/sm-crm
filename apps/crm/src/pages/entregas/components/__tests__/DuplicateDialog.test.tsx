import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const clonePost = vi.fn();
const cloneWorkflow = vi.fn();
vi.mock('@/store', () => ({
  clonePost: (...a: unknown[]) => clonePost(...a),
  cloneWorkflow: (...a: unknown[]) => cloneWorkflow(...a),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { DuplicateDialog, duplicateErrorMessage } from '../DuplicateDialog';

beforeEach(() => {
  clonePost.mockReset();
  cloneWorkflow.mockReset();
  toastError.mockReset();
});

describe('DuplicateDialog', () => {
  it('post: manter status é o padrão e chama clonePost(id, false)', async () => {
    clonePost.mockResolvedValue(99);
    const onDuplicated = vi.fn();
    const onClose = vi.fn();
    const target = { kind: 'post' as const, postId: 5, status: 'revisao_interna' };
    render(<DuplicateDialog target={target} onClose={onClose} onDuplicated={onDuplicated} />);

    expect(screen.getByRole('heading', { name: 'Duplicar post' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Manter status atual/)).toBeChecked();
    expect(screen.queryByText(/é preciso agendar de novo/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(99, target));
    expect(clonePost).toHaveBeenCalledWith(5, false);
    expect(onClose).toHaveBeenCalled();
  });

  it('post agendado mostra o aviso de reagendar', () => {
    render(
      <DuplicateDialog
        target={{ kind: 'post', postId: 5, status: 'agendado' }}
        onClose={vi.fn()}
        onDuplicated={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'Posts agendados, postados ou com falha voltam para Aprovado pelo cliente. A data fica, mas é preciso agendar de novo.',
      ),
    ).toBeInTheDocument();
  });

  it('fluxo em rascunho chama cloneWorkflow(id, true) e mostra a contagem', async () => {
    cloneWorkflow.mockResolvedValue(42);
    const onDuplicated = vi.fn();
    const target = { kind: 'workflow' as const, workflowId: 8, postsCount: 3, active: true };
    render(<DuplicateDialog target={target} onClose={vi.fn()} onDuplicated={onDuplicated} />);

    expect(screen.getByRole('heading', { name: 'Duplicar fluxo' })).toBeInTheDocument();
    expect(screen.getByText('Os 3 posts do fluxo serão copiados com a mídia.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Mudar tudo para Rascunho/));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(42, target));
    expect(cloneWorkflow).toHaveBeenCalledWith(8, true);
  });

  it('erro: toast e o diálogo continua aberto', async () => {
    clonePost.mockRejectedValue({ message: 'plan_limit_exceeded:max_posts_per_workflow' });
    const onClose = vi.fn();
    render(
      <DuplicateDialog
        target={{ kind: 'post', postId: 5, status: 'rascunho' }}
        onClose={onClose}
        onDuplicated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/posts por fluxo/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('em voo: botões desabilitados', async () => {
    let resolve!: (v: number) => void;
    clonePost.mockReturnValue(new Promise<number>((r) => (resolve = r)));
    render(
      <DuplicateDialog
        target={{ kind: 'post', postId: 5, status: 'rascunho' }}
        onClose={vi.fn()}
        onDuplicated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    expect(await screen.findByRole('button', { name: 'Duplicando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => {
      resolve(1);
    });
  });
});

describe('duplicateErrorMessage', () => {
  it('erro genérico', () => {
    expect(duplicateErrorMessage(new Error('boom'))).toBe(
      'Não foi possível duplicar. Tente novamente.',
    );
  });
});
