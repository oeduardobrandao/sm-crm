import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextPostCard } from '../TextPostCard';
import type { HubPost } from '../../types';

vi.mock('../../api', () => ({
  submitApproval: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: () => <div data-testid="post-media-lightbox" />,
}));

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Texto',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Legenda',
    ig_caption: 'Legenda original',
    scheduled_at: '2026-04-22T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

function renderCard(post: HubPost) {
  return (
    <TextPostCard post={post} token="token-publico" approvals={[]} onApprovalSubmitted={vi.fn()} />
  );
}

// A refetch (poll, window focus, or approving another post) can change this post's
// server-side caption while its card sits on screen; the staged copy must follow it
// unless the client has a real pending edit.
function renderExpanded(post: HubPost) {
  const utils = render(renderCard(post));
  fireEvent.click(screen.getByText('Texto'));
  return utils;
}

describe('TextPostCard staged caption sync', () => {
  it('keeps Aprovar enabled when the server caption changes and no edit was made', () => {
    const { rerender } = renderExpanded(makePost());
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled();

    rerender(renderCard(makePost({ ig_caption: 'Legenda atualizada no servidor' })));

    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled();
  });

  it('does not ask to discard after opening and closing Corrigir following a server change', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = renderExpanded(makePost());
    rerender(renderCard(makePost({ ig_caption: 'Legenda atualizada no servidor' })));

    fireEvent.click(screen.getByRole('button', { name: /Correção/i }));
    expect(screen.getByDisplayValue('Legenda atualizada no servidor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('preserves a pending local edit when the server caption changes', () => {
    const { rerender } = renderExpanded(makePost());
    fireEvent.click(screen.getByRole('button', { name: /Correção/i }));
    fireEvent.change(screen.getByDisplayValue('Legenda original'), {
      target: { value: 'Minha edição' },
    });

    rerender(renderCard(makePost({ ig_caption: 'Legenda atualizada no servidor' })));

    expect(screen.getByDisplayValue('Minha edição')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Legenda atualizada no servidor')).not.toBeInTheDocument();
  });
});
