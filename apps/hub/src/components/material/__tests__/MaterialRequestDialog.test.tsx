import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ptHubMaterial from '../../../../../../packages/i18n/locales/pt/hubMaterial.json';
import enHubMaterial from '../../../../../../packages/i18n/locales/en/hubMaterial.json';
import { HubContext } from '../../../HubContext';
import { makeReferenceItem } from '../../../hooks/__tests__/postReferencesStub';
import { HUB_MATERIAL_KEY, HUB_POSTS_KEY, hubMaterialRequestsQuery } from '../../../queries';
import type { HubMaterialRequest } from '../../../services/materialRequests';
import type { HubPost } from '../../../types';

vi.mock('../../../services/postReferences', async (orig) => ({
  ...(await orig<typeof import('../../../services/postReferences')>()),
  uploadPostReference: vi.fn(),
  addPostReferenceLink: vi.fn(),
  fetchPostReferences: vi.fn(),
}));
vi.mock('../../../services/materialRequests', () => ({
  fetchMaterialRequests: vi.fn(),
  closeMaterialRequest: vi.fn(),
}));
vi.mock('../../../api', () => ({
  fetchPosts: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
  submitApproval: vi.fn(),
}));

import {
  PostReferenceError,
  fetchPostReferences,
  uploadPostReference,
} from '../../../services/postReferences';
import { closeMaterialRequest, fetchMaterialRequests } from '../../../services/materialRequests';
import { fetchPosts } from '../../../api';
import { MaterialRequestDialog } from '../MaterialRequestDialog';

function entry(over: Partial<HubMaterialRequest> = {}, done = [false, false, false]) {
  const labels = ['Vídeo do Dr. Paulo', 'Foto do consultório', 'Lista de exames'];
  const e: HubMaterialRequest = {
    post_id: 7,
    titulo: 'Novembro Azul',
    tipo: 'carrossel',
    scheduled_at: '2026-11-14T15:00:00.000Z',
    platform: 'instagram',
    client_visible: false,
    files_by_item: {},
    request: {
      id: 1,
      post_id: 7,
      status: 'aberto',
      closed_by: null,
      closed_at: null,
      opened_by: null,
      opened_at: '2026-11-01T10:00:00.000Z',
      items: labels.map((label, i) => ({
        id: 10 + i,
        label,
        detail: i === 0 ? 'Até 1 minuto, olhando para a câmera.' : null,
        position: i,
        file_count: done[i] ? 1 : 0,
        done: done[i],
      })),
    },
    ...over,
  };
  return e;
}

function hubPost(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Novembro Azul',
    tipo: 'carrossel',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
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

function setup(
  e: HubMaterialRequest,
  opts: { items?: ReturnType<typeof makeReferenceItem>[] } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData([HUB_MATERIAL_KEY, 'tok'], [e]);
  qc.setQueryData([HUB_POSTS_KEY, 'tok'], { posts: [hubPost()], postApprovals: [] });
  vi.mocked(fetchPostReferences).mockResolvedValue({ can_add: false, items: opts.items ?? [] });
  const onOpenChange = vi.fn();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={{ token: 'tok', workspace: 'ws', bootstrap: {} } as never}>
        <MemoryRouter>
          <BadgeProbe />
          <MaterialRequestDialog token="tok" entry={e} open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return { qc, onOpenChange, invalidate };
}

/** Stands in for the nav badge, which keeps the requests query observed in the app. */
function BadgeProbe() {
  useQuery(hubMaterialRequestsQuery('tok'));
  return null;
}

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('MaterialRequestDialog', () => {
  beforeAll(() => {
    i18n.addResourceBundle('pt', 'hubMaterial', ptHubMaterial, true, true);
    i18n.addResourceBundle('en', 'hubMaterial', enHubMaterial, true, true);
  });
  beforeEach(() => {
    vi.mocked(uploadPostReference).mockReset();
    vi.mocked(closeMaterialRequest).mockReset();
    vi.mocked(fetchMaterialRequests).mockReset().mockResolvedValue([]);
    vi.mocked(fetchPosts).mockReset();
  });

  it('shows the header, the progress and one row per item with Enviar', async () => {
    setup(entry({}, [true, false, false]));
    expect(screen.getByText('A equipe precisa de 3 itens')).toBeInTheDocument();
    expect(screen.getByText('1 de 3 enviados')).toBeInTheDocument();
    expect(screen.getByText('Aguardando material')).toBeInTheDocument();
    for (const label of ['Vídeo do Dr. Paulo', 'Foto do consultório', 'Lista de exames']) {
      expect(within(row(label)).getByRole('button', { name: /Enviar/ })).toBeInTheDocument();
    }
    expect(screen.getByText('Até 1 minuto, olhando para a câmera.')).toBeInTheDocument();
    expect(screen.getByText('Fotos e PDFs até 25 MB, vídeos até 200 MB.')).toBeInTheDocument();
    expect(
      screen.getByText('Quando os 3 itens tiverem arquivo, a equipe é avisada. Não tem algum?'),
    ).toBeInTheDocument();
  });

  it('uploads a chosen file with the materialItemId of its row', async () => {
    const item = makeReferenceItem(99, { material_item_id: 11 });
    vi.mocked(uploadPostReference).mockResolvedValue(item);
    const { invalidate } = setup(entry());
    await waitFor(() => expect(fetchPostReferences).toHaveBeenCalled());
    const input = within(row('Foto do consultório')).getByTestId('reference-file-input-item-11');
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadPostReference).toHaveBeenCalled());
    expect(vi.mocked(uploadPostReference).mock.calls[0][1]).toBe(7);
    expect(vi.mocked(uploadPostReference).mock.calls[0][3]).toEqual(
      expect.objectContaining({ materialItemId: 11 }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [HUB_MATERIAL_KEY, 'tok'] }),
    );
  });

  it('disables Enviei o que tenho with nothing done', () => {
    setup(entry());
    expect(screen.getByRole('button', { name: 'Enviei o que tenho' })).toBeDisabled();
  });

  it('confirms before closing and invalidates the requests and the post references', async () => {
    vi.mocked(closeMaterialRequest).mockResolvedValue(undefined);
    const { invalidate, onOpenChange } = setup(entry({}, [true, false, false]));
    fireEvent.click(screen.getByRole('button', { name: 'Enviei o que tenho' }));
    expect(closeMaterialRequest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Avisar a equipe' }));
    await waitFor(() => expect(closeMaterialRequest).toHaveBeenCalledWith('tok', 7));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [HUB_MATERIAL_KEY, 'tok'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hub-post-references', 7] });
  });

  it('offers Histórico e comentários only for a client-visible post', () => {
    setup(entry({ client_visible: true }));
    expect(screen.getByRole('tab', { name: /Itens pedidos/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Histórico e comentários' })).toBeInTheDocument();
    expect(screen.queryByText('Este post ainda está em produção')).not.toBeInTheDocument();
  });

  it('has no history tab on a draft and says it is still in production', () => {
    setup(entry({ client_visible: false }));
    expect(screen.queryByRole('tab', { name: 'Histórico e comentários' })).not.toBeInTheDocument();
    expect(screen.getByText('Este post ainda está em produção')).toBeInTheDocument();
  });

  it('says the team closed the request and refetches when an upload hits request_closed', async () => {
    vi.mocked(uploadPostReference).mockRejectedValue(new PostReferenceError('request_closed'));
    setup(entry());
    await waitFor(() => expect(fetchPostReferences).toHaveBeenCalled());
    const before = vi.mocked(fetchMaterialRequests).mock.calls.length;
    const input = within(row('Lista de exames')).getByTestId('reference-file-input-item-12');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'lista.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('Este pedido foi encerrado pela equipe.')).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(fetchMaterialRequests).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('lists the files already sent under their item', async () => {
    setup(entry({}, [true, false, false]), {
      items: [makeReferenceItem(5, { name: 'checkup.mov', material_item_id: 10 })],
    });
    expect(await within(row('Vídeo do Dr. Paulo')).findByText('checkup.mov')).toBeInTheDocument();
  });

  it('disables Enviar at the 10-file cap and explains why', async () => {
    const items = Array.from({ length: 10 }, (_, i) => makeReferenceItem(i + 1));
    setup(entry({}, [true, false, false]), { items });
    expect(
      await screen.findByText(
        'Este post chegou ao limite de 10 arquivos. Envie o resto como link ou toque em Enviei o que tenho.',
      ),
    ).toBeInTheDocument();
    expect(
      within(row('Foto do consultório')).getByRole('button', { name: /Enviar/ }),
    ).toBeDisabled();
  });
});
