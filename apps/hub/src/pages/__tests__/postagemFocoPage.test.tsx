import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import { PostagemFocoPage } from '../PostagemFocoPage';

vi.mock('../../api', () => ({ fetchPosts: vi.fn() }));
import { fetchPosts } from '../../api';
const mockedFetchPosts = vi.mocked(fetchPosts);

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

function makePost(over: Record<string, unknown> = {}) {
  return {
    id: 42, titulo: 'Post de teste', tipo: 'feed', status: 'enviado_cliente', ordem: 0,
    conteudo: null, conteudo_plain: 'Corpo do post', scheduled_at: null, ig_caption: null,
    instagram_permalink: null, media: [], ...over,
  };
}

function renderAt(postId: string, resp: unknown, reject = false) {
  if (reject) mockedFetchPosts.mockRejectedValue(new Error('boom'));
  else mockedFetchPosts.mockResolvedValue(resp as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={[`/mesaas/hub/token-publico/postagens/${postId}`]}>
          <Routes>
            <Route path="/:workspace/hub/:token/postagens/:postId" element={<PostagemFocoPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('PostagemFocoPage', () => {
  it('renders the focused post when present and client-visible', async () => {
    renderAt('42', { posts: [makePost()], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null });
    expect(await screen.findByText('Post de teste')).toBeInTheDocument();
  });

  it('shows not-available for an internal-status post', async () => {
    renderAt('42', { posts: [makePost({ status: 'revisao_interna' })], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null });
    expect(await screen.findByText(/não está disponível/i)).toBeInTheDocument();
  });

  it('shows not-available for a missing id', async () => {
    renderAt('999', { posts: [makePost()], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null });
    expect(await screen.findByText(/não está disponível/i)).toBeInTheDocument();
  });

  it('shows an error state with retry when the query fails', async () => {
    renderAt('42', null, true);
    expect(await screen.findByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });
});
