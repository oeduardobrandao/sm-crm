import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPost } from '../../../../store';

vi.mock('../../../../services/instagram', () => ({
  retryInstagramPublish: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from 'sonner';
import { retryInstagramPublish } from '../../../../services/instagram';
import { PublishErrorBlock } from '../PublishErrorBlock';

// Copied from ScheduleButton.test.tsx:44-58.
function makePost(overrides?: Partial<WorkflowPost>): WorkflowPost {
  return {
    id: 1,
    workflow_id: 10,
    titulo: 'Test Post',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: 0,
    status: 'aprovado_cliente',
    scheduled_at: '2026-12-01T10:00:00Z',
    ig_caption: 'Test caption #hashtag',
    ...overrides,
  };
}

describe('PublishErrorBlock', () => {
  it('TOKEN_EXPIRED: mostra copy e link de reconexão para /clientes/:id/redes-sociais', () => {
    render(
      <MemoryRouter>
        <PublishErrorBlock
          post={makePost({
            status: 'falha_publicacao',
            publish_error_code: 'TOKEN_EXPIRED',
            publish_error: 'raw',
          })}
          clienteId={42}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Conexão com o Instagram expirou')).toBeTruthy();
    const link = screen.getByRole('link', { name: /reconectar instagram/i });
    expect(link.getAttribute('href')).toBe('/clientes/42/redes-sociais');
    expect(screen.queryByText('raw')).toBeNull(); // mostrarDetalhes: false
  });

  it('IG_TRANSIENT: mostra botão tentar novamente e detalhes técnicos', () => {
    render(
      <MemoryRouter>
        <PublishErrorBlock
          post={makePost({
            status: 'falha_publicacao',
            publish_error_code: 'IG_TRANSIENT',
            publish_error: 'An unexpected error has occurred',
          })}
          clienteId={42}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
    fireEvent.click(screen.getByText(/detalhes técnicos/i));
    expect(screen.getByText('An unexpected error has occurred')).toBeTruthy();
  });

  it('INTERNAL: sem botão e sem detalhes técnicos', () => {
    render(
      <MemoryRouter>
        <PublishErrorBlock
          post={makePost({
            status: 'falha_publicacao',
            publish_error_code: 'INTERNAL',
            publish_error: 'Tag length overflows ciphertext',
          })}
          clienteId={42}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeNull();
    expect(screen.queryByText(/detalhes técnicos/i)).toBeNull();
    expect(screen.queryByText('Tag length overflows ciphertext')).toBeNull();
  });
});

describe('PublishErrorBlock, COLLABORATOR_INVALID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const collabPost = () =>
    makePost({
      status: 'falha_publicacao',
      publish_error_code: 'COLLABORATOR_INVALID',
      publish_error: 'Invalid collaborator',
      ig_collaborators: ['dra.julia'],
      ig_collaborators_refused: ['dra.julia'],
    });

  function renderCollab(props: { onEditCollaborators?: () => void; onStatusChange?: () => void }) {
    return render(
      <MemoryRouter>
        <PublishErrorBlock post={collabPost()} clienteId={42} {...props} />
      </MemoryRouter>,
    );
  }

  it('mostra a copy e os três botões, sem detalhes técnicos', () => {
    renderCollab({ onEditCollaborators: vi.fn() });
    expect(screen.getByText('O Instagram recusou um colaborador')).toBeTruthy();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar colaboradores' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publicar sem colaboradores' })).toBeTruthy();
    expect(screen.queryByText(/detalhes técnicos/i)).toBeNull();
  });

  it('Editar colaboradores chama o callback do editor', () => {
    const onEditCollaborators = vi.fn();
    renderCollab({ onEditCollaborators });
    fireEvent.click(screen.getByRole('button', { name: 'Editar colaboradores' }));
    expect(onEditCollaborators).toHaveBeenCalledTimes(1);
  });

  it('Tentar novamente reagenda sem limpar a lista', async () => {
    vi.mocked(retryInstagramPublish).mockResolvedValue({ ok: true });
    const onStatusChange = vi.fn();
    renderCollab({ onEditCollaborators: vi.fn(), onStatusChange });
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    expect(retryInstagramPublish).toHaveBeenCalledWith(1);
  });

  it('Publicar sem colaboradores confirma e chama o retry com clearCollaborators', async () => {
    vi.mocked(retryInstagramPublish).mockResolvedValue({ ok: true });
    const onStatusChange = vi.fn();
    renderCollab({ onEditCollaborators: vi.fn(), onStatusChange });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar sem colaboradores' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Publicar sem colaboradores?')).toBeTruthy();
    expect(within(dialog).getByText('O post será publicado só no perfil do cliente.')).toBeTruthy();
    expect(retryInstagramPublish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar sem colaboradores' }));
    await waitFor(() =>
      expect(retryInstagramPublish).toHaveBeenCalledWith(1, { clearCollaborators: true }),
    );
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(
      'Post reagendado. A publicação será tentada novamente.',
    );
  });

  it('Publicar sem colaboradores: falha mostra o toast de erro e não atualiza', async () => {
    vi.mocked(retryInstagramPublish).mockRejectedValue(new Error('Falhou'));
    const onStatusChange = vi.fn();
    renderCollab({ onEditCollaborators: vi.fn(), onStatusChange });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar sem colaboradores' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar sem colaboradores' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Falhou'));
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('cancelar o diálogo não chama o serviço', async () => {
    renderCollab({ onEditCollaborators: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar sem colaboradores' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(retryInstagramPublish).not.toHaveBeenCalled();
  });
});
