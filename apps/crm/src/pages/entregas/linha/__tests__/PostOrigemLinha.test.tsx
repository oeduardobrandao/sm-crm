import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinhaEditorial, LinhaItem, LinhaResposta } from '@/store/linhaEditorial';

const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: limitsMock.features, limits: null, isLoading: false }),
}));

const storeMock = vi.hoisted(() => ({
  getOrigemDoPost: vi.fn(),
  listRespostas: vi.fn(),
}));
vi.mock('@/store/linhaEditorial', () => storeMock);

import { PostOrigemLinha } from '../PostOrigemLinha';

const linha = {
  id: 'l1',
  cliente_id: 42,
  periodo: '2026-11-01',
  status: 'aprovada',
} as LinhaEditorial;
const item = { id: 'i1', linha_id: 'l1', post_id: 7 } as LinhaItem;

function resposta(over: Partial<LinhaResposta>): LinhaResposta {
  return {
    id: 'r',
    linha_id: 'l1',
    item_id: 'i1',
    acao: 'comentario',
    comentario: null,
    rodada: 1,
    is_workspace_user: false,
    author_user_id: null,
    created_at: '2026-10-20T12:00:00Z',
    ...over,
  };
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostOrigemLinha postId={7} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PostOrigemLinha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_linha_editorial: true };
  });
  afterEach(cleanup);

  it('renders nothing without origin', async () => {
    storeMock.getOrigemDoPost.mockResolvedValue(null);
    const { container } = renderIt();
    await waitFor(() => expect(storeMock.getOrigemDoPost).toHaveBeenCalledWith(7));
    expect(container).toBeEmptyDOMElement();
    expect(storeMock.listRespostas).not.toHaveBeenCalled();
  });

  it('renders chip and client comments', async () => {
    storeMock.getOrigemDoPost.mockResolvedValue({ linha, item });
    storeMock.listRespostas.mockResolvedValue([
      resposta({ id: 'a', comentario: 'Trocar a chamada' }),
      resposta({ id: 'b', comentario: 'Interno da equipe', is_workspace_user: true }),
      resposta({ id: 'c', comentario: 'De outro item', item_id: 'i2' }),
      resposta({ id: 'd', acao: 'aprovado', comentario: null }),
    ]);
    renderIt();
    const chip = await screen.findByRole('link', { name: /Da linha editorial de novembro/ });
    expect(chip).toHaveAttribute('href', '/entregas?view=linha&clientes=42&mes=2026-11');
    expect(
      await screen.findByText('Comentários do cliente na linha editorial'),
    ).toBeInTheDocument();
    expect(screen.getByText('Trocar a chamada')).toBeInTheDocument();
    expect(screen.queryByText('Interno da equipe')).not.toBeInTheDocument();
    expect(screen.queryByText('De outro item')).not.toBeInTheDocument();
  });

  it('hidden when flag off', async () => {
    limitsMock.features = { feature_linha_editorial: false };
    storeMock.getOrigemDoPost.mockResolvedValue({ linha, item });
    const { container } = renderIt();
    await new Promise((r) => setTimeout(r, 30));
    expect(storeMock.getOrigemDoPost).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
