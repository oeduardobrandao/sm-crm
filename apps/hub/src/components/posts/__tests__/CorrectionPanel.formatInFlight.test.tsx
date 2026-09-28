import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrectionPanel } from '../CorrectionPanel';
import type { HubPost } from '../../../types';
import type { useEditSuggestion } from '../../../hooks/useEditSuggestion';

// A formatting-only edit (bold, an image) changes the TipTap doc but not its plain text.
// The stub exposes a button that emits exactly that: a new doc object, same plain text.
vi.mock('../../RichTextContent', () => ({
  RichTextContent: ({
    content,
    onUpdate,
  }: {
    content: unknown;
    onUpdate?: (json: unknown, plain: string) => void;
  }) => (
    <div>
      <span data-testid="doc">{JSON.stringify(content)}</span>
      <button
        type="button"
        onClick={() => onUpdate?.({ type: 'doc', bold: true }, 'Corpo do post')}
      >
        format
      </button>
    </div>
  ),
}));

type Edit = ReturnType<typeof useEditSuggestion>;

const DRAFT_DOC = { type: 'doc' };

function makeEdit(over: Partial<Edit> = {}): Edit {
  return {
    isEditable: true,
    hasPendingSuggestion: false,
    wasRejected: false,
    saveSuggestion: vi.fn(),
    saveState: 'idle',
    approvalBlocked: false,
    dirty: false,
    saveFailed: false,
    discardFailedSave: vi.fn(),
    draftConteudo: DRAFT_DOC,
    draftConteudoPlain: 'Corpo do post',
    draftIgCaption: 'Legenda original',
    suggestion: null,
    ...over,
  };
}

const textPost: HubPost = {
  id: 10,
  titulo: 'Post',
  tipo: 'feed',
  status: 'enviado_cliente',
  ordem: 1,
  conteudo: DRAFT_DOC,
  conteudo_plain: 'Corpo do post',
  scheduled_at: null,
  ig_caption: 'Legenda original',
  instagram_permalink: null,
  published_at: null,
  publish_error: null,
  workflow_id: null,
  workflow_titulo: null,
  workflow_created_at: null,
  media: [],
  cover_media: null,
  pending_suggestion: null,
  suggestion_rejected_at: null,
};

describe('CorrectionPanel: formatting-only edits', () => {
  it('keeps the formatting edit and does not report a clean save', () => {
    const onSavedClean = vi.fn();
    const edit = makeEdit();
    const props = {
      post: textPost,
      submitting: false,
      onSubmitCorrection: vi.fn(),
      onDirtyChange: vi.fn(),
      onSavedClean,
    };
    const { rerender } = render(<CorrectionPanel {...props} edit={edit} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do post' }), {
      target: { value: 'Legenda enviada' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledTimes(1);

    // Bold applied while the request is in flight: same plain text, new doc.
    fireEvent.click(screen.getByRole('button', { name: 'format' }));

    rerender(<CorrectionPanel {...props} edit={makeEdit({ saveState: 'saved' })} />);
    expect(screen.getByTestId('doc')).toHaveTextContent('"bold":true');
    expect(onSavedClean).not.toHaveBeenCalled();
  });

  it('treats a formatting-only edit as unsaved content, and a fresh panel as clean', () => {
    const edit = makeEdit();
    const onContentDirtyChange = vi.fn();
    render(
      <CorrectionPanel
        post={textPost}
        edit={edit}
        submitting={false}
        onSubmitCorrection={vi.fn()}
        onDirtyChange={vi.fn()}
        onContentDirtyChange={onContentDirtyChange}
      />,
    );
    expect(onContentDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: /Salvar edição/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'format' }));
    expect(onContentDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    expect(edit.saveSuggestion).toHaveBeenCalledWith(
      { type: 'doc', bold: true },
      'Corpo do post',
      'Legenda original',
    );
  });
});
