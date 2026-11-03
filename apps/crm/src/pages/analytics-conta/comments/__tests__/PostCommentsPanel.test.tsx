import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostAnalytics } from '../../../../services/analytics';
import type {
  IgComment,
  PostCommentsResponse,
  StoredAnalysis,
} from '../../../../services/instagramComments';

const { getPostCommentsMock, analyzeMock, savedIdsMock, navigateMock } = vi.hoisted(() => ({
  getPostCommentsMock: vi.fn(),
  analyzeMock: vi.fn(),
  savedIdsMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../../services/instagramComments', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/instagramComments')>(
    '../../../../services/instagramComments',
  );
  return {
    ...actual,
    getPostComments: getPostCommentsMock,
    analyzePostComments: analyzeMock,
  };
});

vi.mock('@/store/ideias', () => ({ getSavedSuggestionIds: savedIdsMock }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// The dialog has its own suite; here we only check what it is opened with.
vi.mock('@/components/ideias/NovaIdeiaDialog', () => ({
  NovaIdeiaDialog: ({
    open,
    initialValues,
    onSaved,
  }: {
    open: boolean;
    initialValues?: {
      cliente_id: number;
      titulo: string;
      descricao: string;
      origem_sugestao_id: string;
    } | null;
    onSaved: (id: string) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Nova ideia">
        <p data-testid="ideia-cliente">{initialValues?.cliente_id}</p>
        <p data-testid="ideia-titulo">{initialValues?.titulo}</p>
        <pre data-testid="ideia-descricao">{initialValues?.descricao}</pre>
        <p data-testid="ideia-origem">{initialValues?.origem_sugestao_id}</p>
        <button type="button" onClick={() => onSaved('nova-1')}>
          Salvar ideia
        </button>
      </div>
    ) : null,
}));

import { CommentsApiError } from '../../../../services/instagramComments';
import { PostCommentsPanel } from '../PostCommentsPanel';

function post(overrides: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    id: 1,
    instagram_post_id: 'ig-1',
    caption: 'Rotina de skincare',
    media_type: 'VIDEO',
    permalink: 'https://instagram.com/p/1',
    posted_at: '2026-10-28T12:00:00Z',
    likes: 1284,
    comments: 12,
    reach: 18200,
    impressions: 20000,
    saved: 4,
    shares: 1,
    views: 900,
    profile_visits: 3,
    follows: 2,
    bio_link_clicks: null,
    follows_per_mil_reach: 4,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    ig_score: 70,
    thumbnail_url: null,
    engagement_rate: 3.2,
    saves_rate: 0.8,
    tags: [],
    ...overrides,
  } as PostAnalytics;
}

function comment(overrides: Partial<IgComment> = {}): IgComment {
  return {
    id: 'c1',
    text: 'Amei!! Funciona pra quem tem pele oleosa?',
    timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    username: 'maria',
    like_count: 12,
    replies_count: 1,
    replies_more: false,
    ...overrides,
  };
}

function manyComments(n: number): IgComment[] {
  return Array.from({ length: n }, (_, i) =>
    comment({ id: `c${i}`, username: `user${i}`, text: `Comentário ${i}` }),
  );
}

const ANALYSIS: StoredAnalysis = {
  result: {
    sentimento_geral: 'positivo',
    resumo: 'O público recebeu bem o formato e elogia a didática.',
    distribuicao: { apoio: 58, duvida: 24, critica: 8, discussao: 6, spam: 4 },
    temas: [{ tema: 'Pele oleosa', peso: 31, exemplo: 'Funciona pra pele oleosa?' }],
    perguntas_frequentes: ['Serve para pele oleosa?'],
    ideias: [
      {
        id: 'sug-1',
        titulo: 'Rotina para pele oleosa',
        descricao: 'Carrossel com a rotina adaptada.',
        motivo: '31% perguntam sobre pele oleosa',
      },
      {
        id: 'sug-2',
        titulo: 'Protetor com cor ou sem cor',
        descricao: 'Reels curto de mito ou verdade.',
        motivo: 'a discussão rendeu mais respostas',
      },
    ],
  },
  comments_analyzed: 12,
  comments_count_at_analysis: 12,
  posts_analyzed: 1,
  analyzed_at: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
  period_start: null,
  period_end: null,
};

function response(overrides: Partial<PostCommentsResponse> = {}): PostCommentsResponse {
  const comments = overrides.comments ?? manyComments(12);
  return {
    comments,
    total_fetched: comments.length,
    truncated: false,
    comments_count: comments.length,
    cached_analysis: null,
    ...overrides,
  };
}

function renderPanel(p: PostAnalytics = post(), compact = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PostCommentsPanel clientId={42} post={p} compact={compact} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PostCommentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedIdsMock.mockResolvedValue(new Set());
  });

  it('lista comentários como texto', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    getPostCommentsMock.mockResolvedValue(
      response({ comments: [comment({ id: 'evil', text: evil }), ...manyComments(5)] }),
    );
    const { container } = renderPanel();
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(getPostCommentsMock).toHaveBeenCalledWith(42, 'ig-1');
    const list = screen.getByRole('list', { name: 'Comentários' });
    const first = within(list).getAllByRole('listitem')[0];
    expect(within(first).getByText('@maria')).toBeInTheDocument();
    expect(within(first).getByText('M')).toBeInTheDocument();
    expect(within(first).getByText(/12 curtidas · 1 resposta$/)).toBeInTheDocument();
    expect(within(first).getByText(/há 2 horas/)).toBeInTheDocument();
  });

  it('mostra 25+ respostas e o aviso de truncado', async () => {
    getPostCommentsMock.mockResolvedValue(
      response({
        comments: [comment({ replies_count: 25, replies_more: true, like_count: 1 })],
        total_fetched: 200,
        truncated: true,
      }),
    );
    renderPanel(post({ comments: 340 }));
    expect(await screen.findByText(/1 curtida · 25\+ respostas/)).toBeInTheDocument();
    expect(screen.getByText(/Mostrando os 200 mais recentes/)).toBeInTheDocument();
  });

  it('sem análise mostra Analisar comentários; clique chama analyzePostComments e mostra o chip', async () => {
    getPostCommentsMock.mockResolvedValue(response());
    analyzeMock.mockResolvedValue(ANALYSIS);
    renderPanel();
    const button = await screen.findByRole('button', { name: 'Analisar comentários' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(analyzeMock).toHaveBeenCalledWith(42, 'ig-1'));
    expect(await screen.findByText('Majoritariamente positivo')).toBeInTheDocument();
    expect(screen.getByText(ANALYSIS.result.resumo)).toBeInTheDocument();
    expect(screen.getByText('Apoio 58%')).toBeInTheDocument();
    expect(screen.getByText('Spam 4%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analisar comentários' })).not.toBeInTheDocument();
  });

  it('erro da IA aparece como texto e mantém o botão', async () => {
    getPostCommentsMock.mockResolvedValue(response());
    analyzeMock.mockRejectedValue(new CommentsApiError('ai_unavailable', 503));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Analisar comentários' }));
    expect(
      await screen.findByText('A análise por IA está indisponível no momento.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analisar comentários' })).toBeEnabled();
  });

  it('menos de 5 comentários desabilita o botão com a dica', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: manyComments(3) }));
    renderPanel(post({ comments: 3 }));
    const button = await screen.findByRole('button', { name: 'Analisar comentários' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText('São precisos pelo menos 5 comentários para analisar. Este post tem 3.'),
    ).toBeInTheDocument();
  });

  it('sem comentários mostra o estado vazio', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: [] }));
    renderPanel(post({ comments: 0 }));
    expect(await screen.findByText('Este post ainda não tem comentários.')).toBeInTheDocument();
  });

  it('409 mostra Reconectar Instagram', async () => {
    getPostCommentsMock.mockRejectedValue(new CommentsApiError('missing_comments_scope', 409));
    renderPanel();
    const button = await screen.findByRole('button', { name: 'Reconectar Instagram' });
    fireEvent.click(button);
    expect(navigateMock).toHaveBeenCalledWith('/clientes/42/redes-sociais');
    expect(screen.queryByRole('button', { name: 'Analisar comentários' })).not.toBeInTheDocument();
  });

  it('401 (token expirado) mostra Reconectar Instagram com a cópia de conexão expirada', async () => {
    getPostCommentsMock.mockRejectedValue(new CommentsApiError('TOKEN_EXPIRED', 401));
    renderPanel();
    expect(
      await screen.findByText(
        'A conexão com o Instagram expirou. Reconecte para ver os comentários.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconectar Instagram' }));
    expect(navigateMock).toHaveBeenCalledWith('/clientes/42/redes-sociais');
  });

  it('401 ao analisar também leva a Reconectar Instagram', async () => {
    getPostCommentsMock.mockResolvedValue(response());
    analyzeMock.mockRejectedValue(new CommentsApiError('TOKEN_EXPIRED', 401));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Analisar comentários' }));
    expect(await screen.findByRole('button', { name: 'Reconectar Instagram' })).toBeInTheDocument();
  });

  it('401 que não é token do Instagram mostra a mensagem genérica', async () => {
    getPostCommentsMock.mockRejectedValue(new CommentsApiError('Unauthorized', 401));
    renderPanel();
    expect(
      await screen.findByText('Não foi possível carregar os comentários.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconectar Instagram' })).not.toBeInTheDocument();
  });

  it('analyzed_at inválido não quebra o cabeçalho', async () => {
    getPostCommentsMock.mockResolvedValue(
      response({ cached_analysis: { ...ANALYSIS, analyzed_at: 'not-a-date' } }),
    );
    renderPanel();
    expect(await screen.findByText('12 comentários analisados')).toBeInTheDocument();
  });

  it('404 de post mostra a mensagem genérica', async () => {
    getPostCommentsMock.mockRejectedValue(new CommentsApiError('post_not_found', 404));
    renderPanel();
    expect(
      await screen.findByText('Não foi possível carregar os comentários.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconectar Instagram' })).not.toBeInTheDocument();
  });

  it('erro de rede mostra a mensagem e Tentar de novo', async () => {
    getPostCommentsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPanel();
    expect(
      await screen.findByText('Não foi possível carregar os comentários.'),
    ).toBeInTheDocument();
    getPostCommentsMock.mockResolvedValue(response());
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Analisar comentários' })).toBeInTheDocument();
  });

  it('mostra N comentários novos desde a análise quando o total cresceu', async () => {
    getPostCommentsMock.mockResolvedValue(
      response({ cached_analysis: ANALYSIS, comments: manyComments(14) }),
    );
    analyzeMock.mockResolvedValue({ ...ANALYSIS, comments_count_at_analysis: 16 });
    renderPanel(post({ comments: 16 }));
    expect(await screen.findByText('4 comentários novos desde a análise')).toBeInTheDocument();
    expect(screen.getByText(/12 comentários analisados · há 2 dias/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refazer análise' }));
    await waitFor(() => expect(analyzeMock).toHaveBeenCalledWith(42, 'ig-1'));
    await waitFor(() =>
      expect(screen.queryByText(/comentários novos desde a análise/)).not.toBeInTheDocument(),
    );
  });

  it('Salvar como ideia abre o diálogo preenchido; ideia já salva mostra Salva', async () => {
    getPostCommentsMock.mockResolvedValue(response({ cached_analysis: ANALYSIS }));
    savedIdsMock.mockResolvedValue(new Set(['sug-2']));
    renderPanel();

    const saved = await screen.findByRole('button', { name: /Salva$/ });
    expect(saved).toBeDisabled();
    expect(savedIdsMock).toHaveBeenCalledWith(['sug-1', 'sug-2']);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar como ideia' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova ideia' });
    expect(within(dialog).getByTestId('ideia-cliente')).toHaveTextContent('42');
    expect(within(dialog).getByTestId('ideia-titulo')).toHaveTextContent('Rotina para pele oleosa');
    expect(within(dialog).getByTestId('ideia-descricao').textContent).toBe(
      'Carrossel com a rotina adaptada.\n\nOrigem: comentários de Reels de 28 out (31% perguntam sobre pele oleosa)',
    );
    expect(within(dialog).getByTestId('ideia-origem')).toHaveTextContent('sug-1');

    savedIdsMock.mockResolvedValue(new Set(['sug-1', 'sug-2']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar ideia' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nova ideia' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Salva$/ })).toHaveLength(2));
  });

  it('compacto esconde temas e perguntas atrás de um botão', async () => {
    getPostCommentsMock.mockResolvedValue(response({ cached_analysis: ANALYSIS }));
    renderPanel(post(), true);
    const toggle = await screen.findByRole('button', { name: 'Ver temas e perguntas' });
    expect(screen.queryByText('Pele oleosa')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Pele oleosa')).toBeInTheDocument();
    expect(screen.getByText('Serve para pele oleosa?')).toBeInTheDocument();
  });
});
