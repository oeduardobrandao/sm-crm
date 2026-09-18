import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionPanel } from '../CorrectionPanel';
import type { HubPost } from '../../../types';
import type { useEditSuggestion } from '../../../hooks/useEditSuggestion';

type Edit = ReturnType<typeof useEditSuggestion>;

function makeEdit(over: Partial<Edit> = {}): Edit {
  return {
    isEditable: true,
    hasPendingSuggestion: false,
    wasRejected: false,
    saveSuggestion: vi.fn(),
    saveState: 'idle',
    approvalBlocked: false,
    dirty: false,
    draftConteudo: null,
    draftConteudoPlain: 'Corpo do post',
    draftIgCaption: 'Legenda original',
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 10,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo do post',
    scheduled_at: null,
    ig_caption: 'Legenda original',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [
      {
        id: 1,
        post_id: 10,
        kind: 'image',
        mime_type: 'image/jpeg',
        url: 'https://cdn/a.jpg',
        thumbnail_url: null,
        width: 1,
        height: 1,
        duration_seconds: null,
        is_cover: false,
        sort_order: 0,
      },
    ],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('CorrectionPanel', () => {
  const onDirtyChange = vi.fn();
  const onSubmitCorrection = vi.fn();
  beforeEach(() => {
    onDirtyChange.mockReset();
    onSubmitCorrection.mockReset();
  });

  it('sends a correction with no motivo and no comentário', () => {
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit()}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    const btn = screen.getByRole('button', { name: /Enviar correção/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null);
  });

  it('sends comentário and motivo when given', () => {
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit()}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: ' Trocar a data ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('Trocar a data', 'texto');
  });

  it('hides the Mídia chip on a post without media', () => {
    render(
      <CorrectionPanel
        post={post({ media: [] })}
        edit={makeEdit()}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Mídia' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Texto' })).toBeInTheDocument();
  });

  it('stages a caption edit, reports dirty, and saves through edit.saveSuggestion', () => {
    const edit = makeEdit();
    render(
      <CorrectionPanel
        post={post()}
        edit={edit}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    const save = screen.getByRole('button', { name: /Salvar edição/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue('Legenda original'), {
      target: { value: 'Legenda editada' },
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(save).toBeEnabled();
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeDisabled();
    fireEvent.click(save);
    expect(edit.saveSuggestion).toHaveBeenCalledWith(null, 'Corpo do post', 'Legenda editada');
  });

  it('seeds the caption from conteudo_plain LEGENDA when there is no ig_caption', () => {
    render(
      <CorrectionPanel
        post={post({ ig_caption: null, conteudo_plain: 'Roteiro\nLEGENDA: texto da legenda' })}
        edit={makeEdit({
          draftIgCaption: null,
          draftConteudoPlain: 'Roteiro\nLEGENDA: texto da legenda',
        })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByDisplayValue('texto da legenda')).toBeInTheDocument();
  });

  it('shows the retry message after a failed save', () => {
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit({ dirty: true, saveState: 'idle' })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByText('Não foi possível salvar. Tente novamente.')).toBeInTheDocument();
  });

  it('hides the retry message right after clicking Salvar edição, before saveState leaves idle', () => {
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit({ dirty: true, saveState: 'idle' })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByText('Não foi possível salvar. Tente novamente.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(screen.queryByText('Não foi possível salvar. Tente novamente.')).not.toBeInTheDocument();
  });

  it('keeps the Salvar edição button enabled to allow retrying a failed save with no local edit', () => {
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit({ dirty: true, saveState: 'idle' })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByRole('button', { name: /Salvar edição/ })).toBeEnabled();
  });

  it('collapses to the pending message when a suggestion is pending', () => {
    render(
      <CorrectionPanel
        post={post()}
        edit={makeEdit({ hasPendingSuggestion: true, approvalBlocked: true })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByText('Sugestão enviada para revisão da equipe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar correção/ })).not.toBeInTheDocument();
  });

  it('shows the rejected warning when the previous suggestion was rejected', () => {
    render(
      <CorrectionPanel
        post={post({ suggestion_rejected_at: '2026-01-01T00:00:00Z' })}
        edit={makeEdit({ wasRejected: true })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByText(/rejeitada pela equipe/)).toBeInTheDocument();
  });
});
