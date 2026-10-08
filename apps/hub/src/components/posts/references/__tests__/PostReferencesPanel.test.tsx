import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostReferencesPanel } from '../PostReferencesPanel';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../../hooks/__tests__/postReferencesStub';
import { PostReferenceError } from '../../../../services/postReferences';
import type { HubPost } from '../../../../types';
import type { PostReferencesState } from '../../../../hooks/usePostReferences';

const MB = 1024 * 1024;

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo',
    scheduled_at: null,
    ig_caption: 'Legenda',
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
    ...over,
  };
}

function renderPanel(refs: PostReferencesState, p: HubPost = post(), onOpen = vi.fn()) {
  render(<PostReferencesPanel post={p} refs={refs} onOpen={onOpen} />);
  return { onOpen };
}

describe('PostReferencesPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows loading until the first response', () => {
    renderPanel(makePostReferencesStub({ data: undefined, isLoading: true }));
    expect(screen.getByText('Carregando referências...')).toBeInTheDocument();
  });

  it('shows the empty state, the add buttons and the hint when the client can add', () => {
    renderPanel(makePostReferencesStub({ canAdd: true }));
    expect(screen.getByText('Nenhuma referência ainda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar arquivo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adicionar link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adicionar referência' })).toBeEnabled();
    expect(
      screen.getByText('0 de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.'),
    ).toBeInTheDocument();
  });

  it('is read-only on a published post', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: false,
        items: [makeReferenceItem(1, { can_remove: false })],
      }),
      post({ status: 'postado' }),
    );
    expect(
      screen.getByText('Post publicado. As referências ficam aqui para consulta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar arquivo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover referência' })).not.toBeInTheDocument();
  });

  it('uses the neutral read-only notice outside postado', () => {
    renderPanel(
      makePostReferencesStub({ canAdd: false, items: [makeReferenceItem(1)] }),
      post({ status: 'aprovado_cliente' }),
    );
    expect(screen.getByText('As referências ficam aqui para consulta.')).toBeInTheDocument();
  });

  it('explains the 10-reference cap on a pending post the server closed', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: false,
        items: Array.from({ length: 10 }, (_, i) => makeReferenceItem(i + 1)),
      }),
      post({ status: 'enviado_cliente' }),
    );
    expect(
      screen.getByText('Este post já tem 10 referências. Remova uma para adicionar outra.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('As referências ficam aqui para consulta.')).not.toBeInTheDocument();
  });

  it('keeps the neutral read-only notice on a pending post under the cap', () => {
    renderPanel(
      makePostReferencesStub({ canAdd: false, items: [makeReferenceItem(1)] }),
      post({ status: 'enviado_cliente' }),
    );
    expect(screen.getByText('As referências ficam aqui para consulta.')).toBeInTheDocument();
    expect(
      screen.queryByText('Este post já tem 10 referências. Remova uma para adicionar outra.'),
    ).not.toBeInTheDocument();
  });

  it('renders file and link rows with note, author, size and domain', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        items: [
          makeReferenceItem(1, { name: 'foto.jpg', note: 'Usar esta foto' }),
          makeReferenceItem(2, {
            kind: 'link',
            file_kind: null,
            name: null,
            size_bytes: null,
            url: null,
            thumbnail_url: null,
            link_url: 'https://exemplo.com/p',
            link_title: 'Post da marca',
            link_domain: 'exemplo.com',
          }),
        ],
      }),
    );
    const list = screen.getByRole('list', { name: 'Referências do post' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('foto.jpg')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Usar esta foto')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/^Você · .* · 2,4 MB$/)).toBeInTheDocument();
    const link = within(rows[1]).getByRole('link', { name: 'Abrir Post da marca' });
    expect(link).toHaveAttribute('href', 'https://exemplo.com/p');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(rows[1]).getByText('exemplo.com')).toBeInTheDocument();
    expect(
      screen.getByText('2 de 10 por post. Fotos e PDFs até 25 MB, vídeos até 200 MB.'),
    ).toBeInTheDocument();
  });

  it('opens an image in the viewer and a PDF in a new tab', () => {
    const { onOpen } = renderPanel(
      makePostReferencesStub({
        canAdd: true,
        items: [
          makeReferenceItem(1, { name: 'foto.jpg' }),
          makeReferenceItem(2, {
            name: 'tabela.pdf',
            file_kind: 'document',
            mime_type: 'application/pdf',
            thumbnail_url: null,
            url: 'https://r2/get/2',
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(screen.getByRole('link', { name: 'Abrir tabela.pdf' })).toHaveAttribute(
      'href',
      'https://r2/get/2',
    );
  });

  it('removes only after the confirm', async () => {
    const refs = makePostReferencesStub({ canAdd: true, items: [makeReferenceItem(1)] });
    renderPanel(refs);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    expect(confirm).toHaveBeenCalledWith('Remover referência?');
    expect(refs.remove).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    await waitFor(() => expect(refs.remove).toHaveBeenCalledWith(1));
  });

  it('shows the locked copy when the team already acted', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1)],
      remove: vi.fn(async () => {
        throw new PostReferenceError('locked');
      }),
    });
    renderPanel(refs);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A equipe já recebeu esta referência. Ela não pode mais ser alterada.',
    );
  });

  it('opens the note field for a fresh upload and saves it', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(5)],
      freshIds: [5],
    });
    renderPanel(refs);
    const field = screen.getByLabelText('O que mudar com isso? (opcional)');
    fireEvent.change(field, { target: { value: 'Trocar a capa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    await waitFor(() => expect(refs.updateNote).toHaveBeenCalledWith(5, 'Trocar a capa'));
    await waitFor(() =>
      expect(screen.queryByLabelText('O que mudar com isso? (opcional)')).not.toBeInTheDocument(),
    );
  });

  it('shows upload progress with the size copy and cancels', () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      uploadsInFlight: true,
      uploads: [
        {
          localId: 'u1',
          source: 'tab',
          name: 'video.mp4',
          fileKind: 'video',
          loaded: 24 * MB,
          total: 38 * MB,
          status: 'uploading',
        },
      ],
    });
    renderPanel(refs);
    expect(screen.getByRole('progressbar', { name: 'Envio de video.mp4' })).toHaveAttribute(
      'aria-valuenow',
      '63',
    );
    expect(screen.getByText('Enviando 24 MB de 38 MB. Não feche esta tela.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar envio de video.mp4' }));
    expect(refs.cancelUpload).toHaveBeenCalledWith('u1');
    expect(screen.queryByText('Nenhuma referência ainda')).not.toBeInTheDocument();
  });

  it('shows a too-large error without retry, and a generic error with retry', () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      uploads: [
        {
          localId: 'big',
          source: 'tab',
          name: 'big.mov',
          fileKind: 'video',
          loaded: 0,
          total: 230 * MB,
          status: 'error',
          error: 'too_large',
        },
        {
          localId: 'net',
          source: 'tab',
          name: 'foto.jpg',
          fileKind: 'image',
          loaded: 0,
          total: MB,
          status: 'error',
          error: 'internal',
        },
      ],
    });
    renderPanel(refs);
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveTextContent(
      'O vídeo tem 230 MB e o limite é 200 MB. Envie uma versão menor ou um link.',
    );
    expect(alerts[1]).toHaveTextContent('Algo deu errado. Tente novamente.');
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refs.retryUpload).toHaveBeenCalledWith('net');
    fireEvent.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);
    expect(refs.cancelUpload).toHaveBeenCalledWith('big');
  });

  it('starts uploads for every chosen file', () => {
    const refs = makePostReferencesStub({ canAdd: true });
    renderPanel(refs);
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('reference-file-input-panel'), {
      target: { files: [a, b] },
    });
    expect(refs.startUploads).toHaveBeenCalledWith([a, b], {
      onUploaded: undefined,
      source: 'tab',
    });
  });

  it('disables adding at 10 references', () => {
    renderPanel(
      makePostReferencesStub({
        canAdd: true,
        items: Array.from({ length: 10 }, (_, i) => makeReferenceItem(i + 1)),
      }),
    );
    expect(screen.getByRole('button', { name: 'Adicionar arquivo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adicionar referência' })).toBeDisabled();
  });

  it('validates the link address on the client, then adds the link and closes the form', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      addLink: vi.fn(async () => makeReferenceItem(9, { kind: 'link' })),
    });
    renderPanel(refs);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar link' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar link' });
    const address = within(dialog).getByLabelText('Endereço');
    expect(address).toHaveAttribute('type', 'url');
    expect(address).toHaveAttribute('inputmode', 'url');
    expect(within(dialog).getByText('Vamos completar com https:// se faltar.')).toBeInTheDocument();

    fireEvent.change(address, { target: { value: 'não é endereço' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar link' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Informe um endereço válido, começando com http ou https.',
    );
    expect(refs.addLink).not.toHaveBeenCalled();

    fireEvent.change(address, { target: { value: 'exemplo.com/post' } });
    fireEvent.change(within(dialog).getByLabelText('O que a equipe deve ver aqui? (opcional)'), {
      target: { value: 'O enquadramento' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar link' }));
    await waitFor(() =>
      expect(refs.addLink).toHaveBeenCalledWith({
        url: 'exemplo.com/post',
        title: undefined,
        note: 'O enquadramento',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Adicionar link' })).not.toBeInTheDocument(),
    );
  });

  it('keeps the link form open with the server error', async () => {
    const refs = makePostReferencesStub({
      canAdd: true,
      addLink: vi.fn(async () => {
        throw new PostReferenceError('post_not_pending');
      }),
    });
    renderPanel(refs);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar link' }));
    const dialog = screen.getByRole('dialog', { name: 'Adicionar link' });
    fireEvent.change(within(dialog).getByLabelText('Endereço'), {
      target: { value: 'https://exemplo.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar link' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este post não está mais aguardando sua aprovação.',
    );
  });

  it('opens the phone sheet and goes from it to the link form', () => {
    renderPanel(makePostReferencesStub({ canAdd: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar referência' }));
    const sheet = screen.getByRole('dialog', { name: 'Adicionar referência' });
    expect(within(sheet).getByRole('button', { name: 'Foto, vídeo ou PDF' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Link' }));
    expect(screen.queryByRole('dialog', { name: 'Adicionar referência' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Adicionar link' })).toBeInTheDocument();
  });

  it('uses 16px inputs on phones', () => {
    renderPanel(makePostReferencesStub({ canAdd: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar link' }));
    expect(screen.getByLabelText('Endereço').className).toContain('text-[16px]');
  });
});
