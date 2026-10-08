import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrectionPanel } from '../CorrectionPanel';
import type { HubPost } from '../../../types';
import type { useEditSuggestion } from '../../../hooks/useEditSuggestion';
import type { PostReferencesState } from '../../../hooks/usePostReferences';
import type { ReferenceItem } from '../../../types/postReferences';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../hooks/__tests__/postReferencesStub';

type Edit = ReturnType<typeof useEditSuggestion>;

function makeEdit(): Edit {
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
    draftConteudo: null,
    draftConteudoPlain: 'Corpo do post',
    draftIgCaption: 'Legenda original',
    suggestion: null,
  };
}

const POST: HubPost = {
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
  media: [],
  cover_media: null,
  pending_suggestion: null,
  suggestion_rejected_at: null,
};

const ITEM7 = makeReferenceItem(7, { name: 'f7.jpg' });

/** A stub whose upload "finishes" at once and reports the item through onUploaded. */
function attachingRefs(items: ReferenceItem[] = [ITEM7]): PostReferencesState {
  return makePostReferencesStub({
    canAdd: true,
    items,
    startUploads: vi.fn(
      async (_files: File[], opts?: { onUploaded?: (i: ReferenceItem) => void }) => {
        opts?.onUploaded?.(ITEM7);
        return [ITEM7];
      },
    ),
  });
}

function renderPanel(references: PostReferencesState | undefined) {
  const onSubmitCorrection = vi.fn();
  const onDirtyChange = vi.fn();
  const element = (refs: PostReferencesState | undefined) => (
    <CorrectionPanel
      post={POST}
      edit={makeEdit()}
      submitting={false}
      onSubmitCorrection={onSubmitCorrection}
      onDirtyChange={onDirtyChange}
      references={refs}
    />
  );
  const utils = render(element(references));
  return {
    onSubmitCorrection,
    onDirtyChange,
    rerender: (refs: PostReferencesState | undefined) => utils.rerender(element(refs)),
  };
}

function attachFile() {
  fireEvent.change(screen.getByTestId('reference-file-input-composer'), {
    target: { files: [new File(['x'], 'f7.jpg', { type: 'image/jpeg' })] },
  });
}

describe('CorrectionPanel references', () => {
  it('has no attach control without references, or when nothing can be added', () => {
    const { rerender } = renderPanel(undefined);
    expect(screen.queryByRole('button', { name: 'Anexar referência' })).not.toBeInTheDocument();
    rerender(makePostReferencesStub({ canAdd: false }));
    expect(screen.queryByRole('button', { name: 'Anexar referência' })).not.toBeInTheDocument();
  });

  it('offers Anexar referência with the helper line, opening the same sheet', () => {
    renderPanel(attachingRefs([]));
    expect(
      screen.getByText('As referências anexadas também ficam na aba Referências deste post.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anexar referência' }));
    const sheet = screen.getByRole('dialog', { name: 'Adicionar referência' });
    expect(within(sheet).getByRole('button', { name: 'Foto, vídeo ou PDF' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Link' })).toBeInTheDocument();
  });

  it('stages an uploaded reference and sends its id with the correction', () => {
    const { onSubmitCorrection, onDirtyChange } = renderPanel(attachingRefs());
    attachFile();
    const staged = screen.getByRole('list', { name: 'Referências desta correção' });
    expect(within(staged).getByText('f7.jpg')).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null, [7]);
  });

  it('unstaging leaves the reference in place but out of the correction', () => {
    const refs = attachingRefs();
    const { onSubmitCorrection } = renderPanel(refs);
    attachFile();
    fireEvent.click(screen.getByRole('button', { name: 'Tirar f7.jpg da correção' }));
    expect(screen.queryByText('f7.jpg')).not.toBeInTheDocument();
    expect(refs.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null);
  });

  it('drops a staged id once the reference is gone', () => {
    const { onSubmitCorrection, rerender } = renderPanel(attachingRefs());
    attachFile();
    rerender(makePostReferencesStub({ canAdd: true, items: [] }));
    expect(
      screen.queryByRole('button', { name: 'Tirar f7.jpg da correção' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null);
  });

  it('disables Enviar correção while an upload is in flight and says why', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        uploadsInFlight: true,
        uploads: [
          {
            localId: 'u',
            name: 'f9.mp4',
            fileKind: 'video',
            loaded: 1,
            total: 2,
            status: 'uploading',
          },
        ],
      }),
    );
    const send = screen.getByRole('button', { name: /Enviar correção/ });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription('Aguarde o envio terminar');
    expect(
      within(screen.getByRole('list', { name: 'Referências desta correção' })).getByText('f9.mp4'),
    ).toBeInTheDocument();
  });

  it('shows a failed upload in the composer with its error copy', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        uploads: [
          {
            localId: 'u',
            name: 'x.svg',
            fileKind: 'document',
            loaded: 0,
            total: 10,
            status: 'error',
            error: 'unsupported_type',
          },
        ],
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'x.svg: Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
    );
  });
});
