import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../../HubContext';
import type { HubPost, HubPostMedia } from '../../../types';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../hooks/__tests__/postReferencesStub';

const submitApprovalMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
const refsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../hooks/usePostReferences', () => ({
  usePostReferences: () => refsState.current,
}));

import { PostDetailDialog } from '../PostDetailDialog';

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'C',
    is_active: true,
    cliente_id: 1,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

const MEDIA: HubPostMedia = {
  id: 1,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn/a.jpg',
  thumbnail_url: null,
  width: 1080,
  height: 1350,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
};

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Primeiro',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    ig_caption: 'Legenda um',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    workflow_created_at: null,
    media: [MEDIA],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

function tree(posts: HubPost[], onNavigate: (id: number | null) => void) {
  return (
    <HubContext.Provider value={hubValue}>
      <MemoryRouter>
        <PostDetailDialog
          posts={posts}
          currentId={posts[0].id}
          token="token-publico"
          approvals={[]}
          instagramProfile={null}
          isAutoPublish={() => false}
          onNavigate={onNavigate}
          onApprovalSubmitted={() => undefined}
        />
      </MemoryRouter>
    </HubContext.Provider>
  );
}

function renderDialog(posts: HubPost[] = [post(), post({ id: 2, titulo: 'Segundo' })]) {
  const onNavigate = vi.fn();
  const utils = render(tree(posts, onNavigate));
  return { onNavigate, rerender: () => utils.rerender(tree(posts, onNavigate)) };
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

describe('PostDetailDialog references', () => {
  beforeEach(() => {
    submitApprovalMock.mockReset();
    refsState.current = makePostReferencesStub();
  });

  // The default post's body ('Corpo') differs from its caption, so Texto do post shows too:
  // the spec order is Legenda | Texto do post | Referências | Histórico e comentários.
  it('puts Referências between Texto do post and Histórico e comentários, with the count', () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1), makeReferenceItem(2)],
    });
    renderDialog();
    expect(tabNames()).toEqual([
      'Legenda',
      'Texto do post',
      'Referências 2',
      'Histórico e comentários',
    ]);
  });

  it('shows the tab with a zero count while the client can add', () => {
    refsState.current = makePostReferencesStub({ canAdd: true });
    renderDialog();
    expect(tabNames()).toEqual([
      'Legenda',
      'Texto do post',
      'Referências 0',
      'Histórico e comentários',
    ]);
  });

  it('hides the tab when nothing can be added and nothing was added', () => {
    renderDialog([post({ status: 'postado' })]);
    expect(tabNames()).toEqual(['Legenda', 'Texto do post', 'Histórico e comentários']);
  });

  it('keeps a read-only tab on a published post that has references', () => {
    refsState.current = makePostReferencesStub({
      canAdd: false,
      items: [makeReferenceItem(1, { can_remove: false })],
    });
    renderDialog([post({ status: 'postado' })]);
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    expect(
      screen.getByText('Post publicado. As referências ficam aqui para consulta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar arquivo' })).not.toBeInTheDocument();
  });

  it('falls back to Legenda when the selected references tab disappears', () => {
    refsState.current = makePostReferencesStub({ canAdd: true });
    const { rerender } = renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    expect(screen.getByRole('tab', { name: /Referências/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    refsState.current = makePostReferencesStub({ canAdd: false });
    rerender();
    expect(screen.getByRole('tab', { name: 'Legenda' })).toHaveAttribute('aria-selected', 'true');
  });

  it('disables Aprovar while an upload is in flight and says why', () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      uploadsInFlight: true,
      uploads: [
        {
          localId: 'u',
          name: 'v.mp4',
          fileKind: 'video',
          loaded: 1,
          total: 2,
          status: 'uploading',
        },
      ],
    });
    renderDialog();
    const aprovar = screen.getByRole('button', { name: /Aprovar/ });
    expect(aprovar).toBeDisabled();
    expect(aprovar).toHaveAccessibleDescription('Aguarde o envio terminar');
    expect(screen.getByRole('button', { name: 'Post anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próximo post' })).toBeDisabled();
  });

  it('asks before closing while an upload is in flight', () => {
    refsState.current = makePostReferencesStub({ canAdd: true, uploadsInFlight: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNavigate } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
    expect(confirm).toHaveBeenCalledWith(
      'Um envio ainda está em andamento. Sair e cancelar o envio?',
    );
    expect(onNavigate).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('opens an image in the viewer; Escape and arrows stay inside it', () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1, { name: 'foto.jpg' })],
    });
    const { onNavigate } = renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    const viewer = screen.getByRole('dialog', { name: 'foto.jpg' });
    expect(within(viewer).getByRole('img', { name: 'foto.jpg' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'foto.jpg' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Primeiro' })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('refreshes the references after an approval', async () => {
    const refs = makePostReferencesStub({ canAdd: true });
    refsState.current = refs;
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    await screen.findByText('Post aprovado!');
    expect(refs.refresh).toHaveBeenCalled();
  });

  it('sends the staged reference ids with the correction and refreshes', async () => {
    const item = makeReferenceItem(7, { name: 'f7.jpg' });
    const refs = makePostReferencesStub({
      canAdd: true,
      items: [item],
      startUploads: vi.fn(
        async (_files: File[], opts?: { onUploaded?: (i: typeof item) => void }) => {
          opts?.onUploaded?.(item);
          return [item];
        },
      ),
    });
    refsState.current = refs;
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.change(screen.getByTestId('reference-file-input-composer'), {
      target: { files: [new File(['x'], 'f7.jpg', { type: 'image/jpeg' })] },
    });
    expect(screen.getByRole('button', { name: 'Tirar f7.jpg da correção' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    await screen.findByText('Correção enviada!');
    expect(submitApprovalMock).toHaveBeenCalledWith(
      'token-publico',
      1,
      'correcao',
      '',
      undefined,
      [7],
    );
    expect(refs.refresh).toHaveBeenCalled();
  });

  it('disables Enviar correção while an upload is in flight', () => {
    refsState.current = makePostReferencesStub({ canAdd: true, uploadsInFlight: true });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeDisabled();
  });

  it('shows the attached references under the correction in the history tab', async () => {
    refsState.current = makePostReferencesStub({
      canAdd: false,
      items: [makeReferenceItem(1, { name: 'foto.jpg', post_approval_id: 10 })],
    });
    const { fetchPostHistory } = await import('../../../api');
    vi.mocked(fetchPostHistory).mockResolvedValueOnce({
      events: [],
      approvals: [
        {
          id: 10,
          action: 'correcao',
          comentario: 'ajustar',
          motivo: null,
          is_workspace_user: false,
          created_at: '2026-09-01T12:00:00.000Z',
        },
      ],
    });
    renderDialog([post({ status: 'correcao_cliente' })]);
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico e comentários' }));
    expect(await screen.findByText('1 referência anexada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto.jpg' }));
    expect(screen.getByRole('dialog', { name: 'foto.jpg' })).toBeInTheDocument();
  });
});
