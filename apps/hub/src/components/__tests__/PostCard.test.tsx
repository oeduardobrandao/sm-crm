import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCard } from '../PostCard';
import { submitApproval } from '../../api';
import type {
  HubPost,
  HubPostMedia,
  HubPostProperty,
  HubSelectOption,
  PostApproval,
} from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: ({
    initialIndex,
    onClose,
    onStaleUrl,
  }: {
    initialIndex: number;
    onClose: () => void;
    onStaleUrl?: () => void;
  }) => (
    <div data-testid="post-media-lightbox">
      <span>Indice inicial: {initialIndex}</span>
      <button type="button" onClick={onClose}>
        Fechar lightbox
      </button>
      <button type="button" onClick={() => onStaleUrl?.()}>
        Simular URL expirada
      </button>
    </div>
  ),
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 7,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Campanha de Páscoa',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Legenda principal do post.',
    scheduled_at: '2026-04-22T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

function makeProperty(
  name: string,
  type: string,
  value: unknown,
  config: { options?: { id: string; label: string; color: string }[] } = {},
): HubPostProperty {
  return {
    post_id: 7,
    value,
    template_property_definitions: {
      name,
      type,
      config,
      portal_visible: true,
      display_order: 1,
    },
  };
}

describe('PostCard', () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedSubmitApproval.mockReset();
    scrollIntoViewMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  it('renders the expanded details, property values, and approval history when requested by default', () => {
    const workflowSelectOptions: HubSelectOption[] = [
      {
        workflow_id: 42,
        property_definition_id: 1,
        option_id: 'approved',
        label: 'Aprovado internamente',
        color: '#16a34a',
      },
      {
        workflow_id: 42,
        property_definition_id: 2,
        option_id: 'instagram',
        label: 'Instagram',
        color: '#ec4899',
      },
      {
        workflow_id: 42,
        property_definition_id: 2,
        option_id: 'linkedin',
        label: 'LinkedIn',
        color: '#2563eb',
      },
    ];

    const propertyValues: HubPostProperty[] = [
      makeProperty('Link do briefing', 'url', 'example.com/brief'),
      makeProperty('Data da gravação', 'date', '2026-05-10'),
      makeProperty('Precisa de legenda?', 'checkbox', true),
      makeProperty('Prioridade', 'select', 'high', {
        options: [{ id: 'high', label: 'Urgente', color: '#dc2626' }],
      }),
      makeProperty('Etapa interna', 'status', 'approved'),
      makeProperty('Canais', 'multiselect', ['instagram', 'linkedin']),
      makeProperty('Observações extras', 'text', ''),
    ];

    const approvals: PostApproval[] = [
      {
        id: 1,
        post_id: 7,
        action: 'correcao',
        comentario: 'Ajustar CTA final.',
        is_workspace_user: false,
        created_at: '2026-04-18T09:00:00.000Z',
      },
      {
        id: 2,
        post_id: 7,
        action: 'mensagem',
        comentario: 'Podemos subir ainda hoje.',
        is_workspace_user: true,
        created_at: '2026-04-18T10:00:00.000Z',
      },
    ];

    render(
      <PostCard
        post={makePost()}
        token="token-publico"
        approvals={approvals}
        propertyValues={propertyValues}
        workflowSelectOptions={workflowSelectOptions}
        onApprovalSubmitted={vi.fn()}
        defaultExpanded
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(screen.getByText('Legenda principal do post.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'example.com/brief' })).toHaveAttribute('href', 'https://example.com/brief');
    expect(screen.getByText('10/05/2026')).toBeInTheDocument();
    expect(screen.getByText('Sim')).toBeInTheDocument();
    expect(screen.getByText('Urgente')).toBeInTheDocument();
    expect(screen.getByText('Aprovado internamente')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Correção solicitada')).toBeInTheDocument();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText('Ajustar CTA final.')).toBeInTheDocument();
    expect(screen.getByText('Podemos subir ainda hoje.')).toBeInTheDocument();
  });

  it('submits an approval with the optional comment and shows the success feedback', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    const onApprovalSubmitted = vi.fn();

    render(
      <PostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        propertyValues={[]}
        workflowSelectOptions={[]}
        onApprovalSubmitted={onApprovalSubmitted}
        defaultExpanded
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Comentário (opcional)…'), {
      target: { value: 'Pode publicar.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 7, 'aprovado', 'Pode publicar.');
    });

    expect(await screen.findByText('Post aprovado!')).toBeInTheDocument();
    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);
  });

  it('submits correction requests without a comment and exposes API errors to the user', async () => {
    mockedSubmitApproval.mockRejectedValue(new Error('Envio indisponível no momento.'));
    const onApprovalSubmitted = vi.fn();

    render(
      <PostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        propertyValues={[]}
        workflowSelectOptions={[]}
        onApprovalSubmitted={onApprovalSubmitted}
        defaultExpanded
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Solicitar correção/i }));

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 7, 'correcao', undefined);
    });

    expect(await screen.findByText('Envio indisponível no momento.')).toBeInTheDocument();
    expect(onApprovalSubmitted).not.toHaveBeenCalled();
  });

  it('sends trimmed replies for non-pending posts and clears the input after success', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    const onApprovalSubmitted = vi.fn();

    render(
      <PostCard
        post={makePost({ status: 'agendado' })}
        token="token-publico"
        approvals={[]}
        propertyValues={[]}
        workflowSelectOptions={[]}
        onApprovalSubmitted={onApprovalSubmitted}
        defaultExpanded
      />,
    );

    const replyInput = screen.getByPlaceholderText('Enviar mensagem…');
    const sendButton = screen.getByRole('button', { name: 'Enviar' });

    expect(sendButton).toBeDisabled();

    fireEvent.change(replyInput, { target: { value: '  Obrigado pelo retorno!  ' } });

    expect(sendButton).toBeEnabled();

    fireEvent.keyDown(replyInput, { key: 'Enter' });

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 7, 'mensagem', 'Obrigado pelo retorno!');
    });

    expect(replyInput).toHaveValue('');
    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);
  });

  it('opens the media lightbox from the cover image and reuses the refresh callback for stale URLs', () => {
    const onApprovalSubmitted = vi.fn();
    const galleryMedia = [
      makeMedia({ id: 1, url: 'https://cdn.example.com/gallery-1.jpg', sort_order: 0 }),
      makeMedia({ id: 2, url: 'https://cdn.example.com/cover.jpg', sort_order: 1 }),
    ];

    const { container } = render(
      <PostCard
        post={makePost({
          status: 'agendado',
          media: galleryMedia,
          cover_media: galleryMedia[1],
        })}
        token="token-publico"
        approvals={[]}
        propertyValues={[]}
        workflowSelectOptions={[]}
        onApprovalSubmitted={onApprovalSubmitted}
      />,
    );

    const coverButton = container.querySelector('img[src="https://cdn.example.com/cover.jpg"]')?.closest('button');

    if (!coverButton) {
      throw new Error('Cover button was not rendered');
    }

    fireEvent.click(coverButton);

    expect(screen.getByTestId('post-media-lightbox')).toBeInTheDocument();
    expect(screen.getByText('Indice inicial: 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simular URL expirada' }));

    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar lightbox' }));

    expect(screen.queryByTestId('post-media-lightbox')).not.toBeInTheDocument();
  });
});
