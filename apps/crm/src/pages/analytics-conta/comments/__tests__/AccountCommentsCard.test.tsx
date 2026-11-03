import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostAnalytics } from '../../../../services/analytics';
import type { StoredAnalysis } from '../../../../services/instagramComments';

const { getMock, analyzeMock, savedIdsMock, limitsMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  analyzeMock: vi.fn(),
  savedIdsMock: vi.fn(),
  limitsMock: vi.fn(),
}));

vi.mock('../../../../services/instagramComments', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/instagramComments')>(
    '../../../../services/instagramComments',
  );
  return { ...actual, getAccountCommentsAnalysis: getMock, analyzeAccountComments: analyzeMock };
});
vi.mock('@/store/ideias', () => ({ getSavedSuggestionIds: savedIdsMock }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: limitsMock }));
vi.mock('@/components/ideias/NovaIdeiaDialog', () => ({ NovaIdeiaDialog: () => null }));

import { CommentsApiError } from '../../../../services/instagramComments';
import { AccountCommentsCard } from '../AccountCommentsCard';

function post(id: string, thumb: string | null): PostAnalytics {
  return {
    id: Number(id.replace(/\D/g, '')),
    instagram_post_id: id,
    posted_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    comments: 10,
    thumbnail_url: thumb,
  } as unknown as PostAnalytics;
}

const ANALYSIS: StoredAnalysis = {
  result: {
    sentimento_geral: 'misto',
    resumo: 'Engajamento alto nos Reels educativos.',
    distribuicao: { apoio: 44, duvida: 27, critica: 15, discussao: 10, spam: 4 },
    temas: [
      {
        tema: 'Preço e agendamento',
        peso: 22,
        exemplo: 'Aparece em vários posts',
        post_ids: ['ig-1', 'ig-2'],
      },
    ],
    perguntas_frequentes: ['Quanto custa?'],
    ideias: [1, 2, 3].map((n) => ({
      id: `sug-${n}`,
      titulo: `Ideia ${n}`,
      descricao: `Descrição ${n}`,
      motivo: `motivo ${n}`,
    })),
  },
  comments_analyzed: 612,
  comments_count_at_analysis: 612,
  posts_analyzed: 15,
  analyzed_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  period_start: null,
  period_end: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountCommentsCard
          clientId={42}
          posts={[post('ig-1', 'https://img/1.jpg'), post('ig-2', null)]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountCommentsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.mockReturnValue({ features: { feature_instagram_comments_ai: true } });
    savedIdsMock.mockResolvedValue(new Set());
  });

  it('flag desligada → null, sem consulta', () => {
    limitsMock.mockReturnValue({ features: { feature_instagram_comments_ai: false } });
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('sem análise mostra Analisar', async () => {
    getMock.mockResolvedValue({ analysis: null, current_comments: 40 });
    renderCard();
    expect(await screen.findByRole('button', { name: 'Analisar' })).toBeInTheDocument();
    expect(screen.getByText('Últimos 30 dias')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(42);
  });

  it('com análise mostra resumo, temas com miniaturas dos post_ids e 3 ideias', async () => {
    getMock.mockResolvedValue({ analysis: ANALYSIS, current_comments: 612 });
    const { container } = renderCard();
    expect(await screen.findByText('Engajamento alto nos Reels educativos.')).toBeInTheDocument();
    expect(screen.getByText('O que o público está dizendo')).toBeInTheDocument();
    expect(
      screen.getByText(/612 comentários em 15 posts · analisado há 3 dias/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar análise' })).toBeInTheDocument();
    expect(screen.getByText('Temas e de onde vieram')).toBeInTheDocument();
    expect(screen.getByText('Ideias de conteúdo do mês')).toBeInTheDocument();
    expect(container.querySelectorAll('.igc-theme__thumbs img')).toHaveLength(1);
    expect(container.querySelectorAll('.igc-theme__thumb-empty')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Salvar como ideia' })).toHaveLength(3);
  });

  it('posts_analyzed nulo (linha antiga) omite "em M posts"', async () => {
    getMock.mockResolvedValue({
      analysis: { ...ANALYSIS, posts_analyzed: null },
      current_comments: 612,
    });
    renderCard();
    expect(await screen.findByText(/612 comentários · analisado há 3 dias/)).toBeInTheDocument();
    expect(screen.queryByText(/em \d+ posts?/)).toBeNull();
  });

  it('current_comments maior que comments_count_at_analysis mostra o aviso de novos', async () => {
    getMock.mockResolvedValue({ analysis: ANALYSIS, current_comments: 630 });
    renderCard();
    expect(await screen.findByText('18 comentários novos desde a análise')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refazer análise' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atualizar análise' })).not.toBeInTheDocument();
  });

  it('422 mostra a dica de poucos comentários', async () => {
    getMock.mockResolvedValue({ analysis: null, current_comments: 40 });
    analyzeMock.mockRejectedValue(new CommentsApiError('too_few_comments', 422));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Analisar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'São necessários pelo menos 10 comentários nos últimos 30 dias para analisar.',
    );
  });

  it('401 TOKEN_EXPIRED mostra o estado de reconexão', async () => {
    getMock.mockRejectedValue(new CommentsApiError('TOKEN_EXPIRED', 401));
    renderCard();
    expect(await screen.findByText('Conexão expirada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconectar Instagram' })).toBeInTheDocument();
  });

  it('analisar grava o resultado no cartão', async () => {
    getMock.mockResolvedValue({ analysis: null, current_comments: 40 });
    analyzeMock.mockResolvedValue(ANALYSIS);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Analisar' }));
    await waitFor(() =>
      expect(screen.getByText('Engajamento alto nos Reels educativos.')).toBeInTheDocument(),
    );
  });
});
