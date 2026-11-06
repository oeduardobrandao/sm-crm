import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ptHubMaterial from '../../../../../../packages/i18n/locales/pt/hubMaterial.json';
import enHubMaterial from '../../../../../../packages/i18n/locales/en/hubMaterial.json';
import { HubContext } from '../../../HubContext';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../hooks/__tests__/postReferencesStub';
import type { HubMaterialRequest } from '../../../services/materialRequests';
import type { HubPost } from '../../../types';

vi.mock('../../../api', () => ({
  submitApproval: vi.fn(),
  submitEditSuggestion: vi.fn(),
  fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [] }),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
const refsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../hooks/usePostReferences', async (orig) => ({
  ...(await orig<typeof import('../../../hooks/usePostReferences')>()),
  usePostReferences: () => refsState.current,
}));
vi.mock('../../../services/materialRequests', () => ({
  fetchMaterialRequests: vi.fn(),
  closeMaterialRequest: vi.fn(),
}));

import { fetchMaterialRequests } from '../../../services/materialRequests';
import { PostDetailDialog } from '../PostDetailDialog';

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'C',
    is_active: true,
    cliente_id: 1,
  },
  token: 'tok',
  workspace: 'mesaas',
} as never;

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Novembro Azul',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Legenda',
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

const request: HubMaterialRequest = {
  post_id: 7,
  titulo: 'Novembro Azul',
  tipo: 'feed',
  scheduled_at: null,
  platform: null,
  client_visible: true,
  files_by_item: {},
  request: {
    id: 1,
    post_id: 7,
    status: 'aberto',
    closed_by: null,
    closed_at: null,
    opened_by: null,
    opened_at: '2026-11-01T10:00:00.000Z',
    items: [
      { id: 10, label: 'Vídeo do Dr. Paulo', detail: null, position: 0, file_count: 1, done: true },
      {
        id: 11,
        label: 'Foto do consultório',
        detail: null,
        position: 1,
        file_count: 0,
        done: false,
      },
    ],
  },
};

function renderDialog(p: HubPost = post()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter>
          <PostDetailDialog
            posts={[p]}
            currentId={p.id}
            token="tok"
            approvals={[]}
            mediaNotes={[]}
            instagramProfile={null}
            isAutoPublish={() => false}
            onNavigate={() => undefined}
            onApprovalSubmitted={() => undefined}
          />
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

describe('PostDetailDialog material request notice', () => {
  beforeAll(() => {
    i18n.addResourceBundle('pt', 'hubMaterial', ptHubMaterial, true, true);
    i18n.addResourceBundle('en', 'hubMaterial', enHubMaterial, true, true);
  });
  beforeEach(() => {
    refsState.current = makePostReferencesStub();
    vi.mocked(fetchMaterialRequests).mockReset().mockResolvedValue([request]);
  });

  it('shows the notice when its post has an open request and opens the items', async () => {
    renderDialog();
    expect(await screen.findByText('A equipe pediu material para este post')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver itens' }));
    expect(await screen.findByText('A equipe precisa de 2 itens')).toBeInTheDocument();
  });

  it('shows nothing for a post without an open request', async () => {
    vi.mocked(fetchMaterialRequests).mockResolvedValue([{ ...request, post_id: 99 }]);
    renderDialog();
    await screen.findByRole('tab', { name: 'Histórico e comentários' });
    await Promise.resolve();
    expect(screen.queryByText('A equipe pediu material para este post')).not.toBeInTheDocument();
  });

  it('labels item files in Referências with the item name', async () => {
    refsState.current = makePostReferencesStub({
      canAdd: true,
      items: [makeReferenceItem(1, { material_item_id: 10 }), makeReferenceItem(2)],
    });
    renderDialog();
    await screen.findByText('A equipe pediu material para este post');
    fireEvent.click(screen.getByRole('tab', { name: /Referências/ }));
    expect(screen.getByText('Item: Vídeo do Dr. Paulo')).toBeInTheDocument();
    expect(screen.getAllByText(/^Item: /)).toHaveLength(1);
  });
});
