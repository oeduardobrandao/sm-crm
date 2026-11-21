import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostAnalytics } from '../../../../services/analytics';
import type {
  IgComment,
  PostCommentsResponse,
  StoredAnalysis,
} from '../../../../services/instagramComments';

import i18n from 'i18next';
import ptComments from '../../../../../../../packages/i18n/locales/pt/analyticsComments.json';
import enComments from '../../../../../../../packages/i18n/locales/en/analyticsComments.json';

i18n.addResourceBundle('pt', 'analyticsComments', ptComments, true, true);
i18n.addResourceBundle('en', 'analyticsComments', enComments, true, true);

const {
  getPostCommentsMock,
  analyzeMock,
  savedIdsMock,
  navigateMock,
  setHiddenMock,
  deleteMock,
  toastMock,
  canModerateRef,
} = vi.hoisted(() => ({
  getPostCommentsMock: vi.fn(),
  analyzeMock: vi.fn(),
  savedIdsMock: vi.fn(),
  navigateMock: vi.fn(),
  setHiddenMock: vi.fn(),
  deleteMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  canModerateRef: { current: true as boolean | 'unknown' },
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    can: (module: string, action?: string) =>
      module === 'analytics' && action === 'editar' ? canModerateRef.current : true,
  }),
}));

vi.mock('../../../../services/instagramComments', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/instagramComments')>(
    '../../../../services/instagramComments',
  );
  return {
    ...actual,
    getPostComments: getPostCommentsMock,
    analyzePostComments: analyzeMock,
    setCommentHidden: setHiddenMock,
    deleteComment: deleteMock,
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
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PostCommentsPanel clientId={42} post={p} compact={compact} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

describe('PostCommentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedIdsMock.mockResolvedValue(new Set());
    canModerateRef.current = true;
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

  it('mostra 20 comentários e libera mais 20 a cada clique em Ver mais', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: manyComments(45) }));
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Comentários' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais comentários (25)' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais comentários (5)' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(45);
    expect(screen.queryByRole('button', { name: /Ver mais comentários/ })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Mostrando 200 comentários/)).toBeInTheDocument();
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
      screen.getByText('São necessários pelo menos 5 comentários para analisar. Este post tem 3.'),
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
      'Carrossel com a rotina adaptada.\n\nOrigem: comentários do Reels de 28 out (31% perguntam sobre pele oleosa)',
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The `<li>` of the comment whose text is `text`. */
function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('li') as HTMLElement;
}

function moreButton(row: HTMLElement): HTMLElement {
  return within(row).getByRole('button', { name: 'Ações do comentário' });
}

/** Radix opens a dropdown on keydown/pointerdown, not on click. */
async function openMenu(row: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(moreButton(row), { key: 'Enter' });
  return screen.findByRole('menu');
}

async function deleteVia(text: string) {
  const menu = await openMenu(rowOf(text));
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir comentário' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Excluir comentário?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
}

const THREAD: IgComment[] = [
  comment({ id: 'p', text: 'Comentário pai', username: 'ana', replies_count: 2 }),
  comment({ id: 'r1', text: 'Primeira resposta', username: 'bia', parent_id: 'p' }),
  comment({ id: 'q', text: 'Outro comentário', username: 'caio', replies_count: 0 }),
  comment({ id: 'r2', text: 'Segunda resposta', username: 'ana', parent_id: 'p' }),
];

describe('PostCommentsPanel: moderação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedIdsMock.mockResolvedValue(new Set());
    canModerateRef.current = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sem analytics:editar não mostra o botão Ações do comentário', async () => {
    canModerateRef.current = false;
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    renderPanel();
    await screen.findByText('Comentário pai');
    expect(screen.queryByRole('button', { name: 'Ações do comentário' })).not.toBeInTheDocument();
  });

  it("can 'unknown' também não mostra", async () => {
    canModerateRef.current = 'unknown';
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    renderPanel();
    await screen.findByText('Comentário pai');
    expect(screen.queryByRole('button', { name: 'Ações do comentário' })).not.toBeInTheDocument();
  });

  it('respostas aparecem recuadas sob o pai e o rodapé conta itens únicos', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Comentários' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.igc-comment__text')?.textContent)).toEqual([
      'Comentário pai',
      'Primeira resposta',
      'Segunda resposta',
      'Outro comentário',
    ]);
    expect(items[0]).not.toHaveClass('igc-comment--reply');
    expect(items[1]).toHaveClass('igc-comment--reply');
    expect(items[2]).toHaveClass('igc-comment--reply');
    expect(items[3]).not.toHaveClass('igc-comment--reply');
    // Respostas também têm o menu.
    expect(within(items[1]).getByRole('button', { name: 'Ações do comentário' })).toBeEnabled();
    expect(screen.getByText(/Mostrando 4 comentários/)).toBeInTheDocument();
  });

  it('Ver mais pagina por comentários de topo e cada grupo vem com as respostas', async () => {
    const tops = manyComments(21);
    const replies = Array.from({ length: 3 }, (_, i) =>
      comment({ id: `r${i}`, text: `Resposta ${i}`, parent_id: 'c0' }),
    );
    getPostCommentsMock.mockResolvedValue(response({ comments: [...tops, ...replies] }));
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Comentários' });
    // 20 grupos de topo; o primeiro traz as 3 respostas.
    expect(within(list).getAllByRole('listitem')).toHaveLength(23);
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais comentários (1)' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(24);
  });

  it('comentário oculto mostra o selo Oculto e o menu oferece Mostrar comentário', async () => {
    getPostCommentsMock.mockResolvedValue(
      response({ comments: [comment({ id: 'h', text: 'Texto oculto', hidden: true })] }),
    );
    renderPanel();
    await screen.findByText('Texto oculto');
    const row = rowOf('Texto oculto');
    expect(row).toHaveClass('igc-comment--hidden');
    expect(within(row).getByText('Oculto')).toBeInTheDocument();
    const menu = await openMenu(row);
    expect(within(menu).getByRole('menuitem', { name: 'Mostrar comentário' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Ocultar comentário' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Excluir comentário' })).toBeInTheDocument();
  });

  it('comentário do dono mostra Você e o menu não tem Ocultar', async () => {
    getPostCommentsMock.mockResolvedValue(
      response({ comments: [comment({ id: 'o', text: 'Obrigada!', from_owner: true })] }),
    );
    renderPanel();
    await screen.findByText('Obrigada!');
    const row = rowOf('Obrigada!');
    expect(within(row).getByText('Você')).toBeInTheDocument();
    const menu = await openMenu(row);
    expect(within(menu).queryByRole('menuitem', { name: 'Ocultar comentário' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Mostrar comentário' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Excluir comentário' })).toBeInTheDocument();
  });

  it('ocultar é otimista, mostra toast Comentário oculto com Desfazer, e Desfazer chama setCommentHidden(false)', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    const call = deferred<{ id: string; hidden: boolean }>();
    setHiddenMock.mockReturnValueOnce(call.promise);
    renderPanel();
    await screen.findByText('Comentário pai');
    const menu = await openMenu(rowOf('Comentário pai'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ocultar comentário' }));

    // Otimista: oculto antes da resposta do servidor.
    await waitFor(() => expect(rowOf('Comentário pai')).toHaveClass('igc-comment--hidden'));
    expect(setHiddenMock).toHaveBeenCalledWith(42, 'ig-1', 'p', true);
    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => call.resolve({ id: 'p', hidden: true }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('Comentário oculto', {
        action: { label: 'Desfazer', onClick: expect.any(Function) },
      }),
    );
    expect(getPostCommentsMock).toHaveBeenCalledTimes(1); // ocultar não recarrega

    setHiddenMock.mockResolvedValueOnce({ id: 'p', hidden: false });
    const undo = toastMock.mock.calls[0][1].action.onClick as () => void;
    act(() => undo());
    expect(setHiddenMock).toHaveBeenLastCalledWith(42, 'ig-1', 'p', false);
    await waitFor(() => expect(rowOf('Comentário pai')).not.toHaveClass('igc-comment--hidden'));
    await waitFor(() =>
      expect(toastMock).toHaveBeenLastCalledWith('Comentário visível de novo', {
        action: { label: 'Desfazer', onClick: expect.any(Function) },
      }),
    );
  });

  it('Desfazer depois que o painel saiu da tela ainda chama o serviço, sem erro', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    setHiddenMock.mockResolvedValue({ id: 'p', hidden: true });
    const { unmount } = renderPanel();
    await screen.findByText('Comentário pai');
    const menu = await openMenu(rowOf('Comentário pai'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ocultar comentário' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    unmount();
    const undo = toastMock.mock.calls[0][1].action.onClick as () => void;
    setHiddenMock.mockResolvedValue({ id: 'p', hidden: false });
    await act(async () => undo());
    expect(setHiddenMock).toHaveBeenLastCalledWith(42, 'ig-1', 'p', false);
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(2));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('recarga que chega durante o ocultar não desfaz o oculto depois do sucesso', async () => {
    getPostCommentsMock
      .mockResolvedValueOnce(response({ comments: THREAD }))
      .mockResolvedValueOnce(response({ comments: THREAD }));
    const call = deferred<{ id: string; hidden: boolean }>();
    setHiddenMock.mockReturnValueOnce(call.promise);
    const { client } = renderPanel();
    await screen.findByText('Comentário pai');
    const menu = await openMenu(rowOf('Comentário pai'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ocultar comentário' }));
    await waitFor(() => expect(rowOf('Comentário pai')).toHaveClass('igc-comment--hidden'));
    // A recarga lê o estado antigo enquanto a chamada está em voo.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['ig-post-comments', 42, 'ig-1'] });
    });
    await waitFor(() => expect(rowOf('Comentário pai')).not.toHaveClass('igc-comment--hidden'));
    await act(async () => call.resolve({ id: 'p', hidden: true }));
    await waitFor(() => expect(rowOf('Comentário pai')).toHaveClass('igc-comment--hidden'));
  });

  it('erro ao ocultar desfaz o estado local e mostra a mensagem', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    const call = deferred<{ id: string; hidden: boolean }>();
    setHiddenMock.mockReturnValueOnce(call.promise);
    renderPanel();
    await screen.findByText('Comentário pai');
    const menu = await openMenu(rowOf('Comentário pai'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ocultar comentário' }));
    await waitFor(() => expect(rowOf('Comentário pai')).toHaveClass('igc-comment--hidden'));

    await act(async () => call.reject(new CommentsApiError('write_rate_limited', 429)));
    await waitFor(() => expect(rowOf('Comentário pai')).not.toHaveClass('igc-comment--hidden'));
    expect(toastMock.error).toHaveBeenCalledWith(
      'Muitas ações seguidas. Tente de novo em alguns minutos.',
    );
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('excluir abre o diálogo com a citação, Excluir chama deleteComment uma vez mesmo com dois cliques, e a linha e as respostas somem', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    const call = deferred<{ id: string; deleted: true }>();
    deleteMock.mockReturnValueOnce(call.promise);
    renderPanel();
    await screen.findByText('Comentário pai');
    const menu = await openMenu(rowOf('Comentário pai'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir comentário' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Excluir comentário?' });
    expect(within(dialog).getByText('@ana: Comentário pai')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Ele sai do Instagram para todo mundo e não dá para desfazer. Se quiser só tirar da vista, use Ocultar.',
      ),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Excluir' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(42, 'ig-1', 'p');
    // Diálogo segue aberto, com o botão em carregamento e Cancelar travado.
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // A linha só sai depois do sucesso (exclusão não é otimista).
    expect(screen.getByText('Comentário pai')).toBeInTheDocument();

    await act(async () => call.resolve({ id: 'p', deleted: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Comentário pai')).not.toBeInTheDocument();
    expect(screen.queryByText('Primeira resposta')).not.toBeInTheDocument();
    expect(screen.queryByText('Segunda resposta')).not.toBeInTheDocument();
    expect(screen.getByText('Outro comentário')).toBeInTheDocument();
    expect(screen.getByText(/Mostrando 1 comentário/)).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith('Comentário excluído');
  });

  it('citação do diálogo trunca em 140 caracteres com …', async () => {
    const long = '😀'.repeat(200);
    getPostCommentsMock.mockResolvedValue(
      response({ comments: [comment({ id: 'l', text: long, username: 'maria' })] }),
    );
    renderPanel();
    await screen.findByText(long);
    const menu = await openMenu(rowOf(long));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir comentário' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Excluir comentário?' });
    // "@maria: " tem 8 caracteres; sobram 132 emojis inteiros, depois "…".
    const expected = `@maria: ${'😀'.repeat(132)}…`;
    expect(Array.from(expected)).toHaveLength(141);
    expect(within(dialog).getByText(expected)).toBeInTheDocument();
  });

  it('enquanto uma ação está em voo, o ⋯ daquele comentário fica desabilitado', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    const call = deferred<{ id: string; hidden: boolean }>();
    setHiddenMock.mockReturnValueOnce(call.promise);
    renderPanel();
    await screen.findByText('Comentário pai');
    const menu = await openMenu(rowOf('Comentário pai'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ocultar comentário' }));
    await waitFor(() => expect(moreButton(rowOf('Comentário pai'))).toBeDisabled());
    expect(moreButton(rowOf('Outro comentário'))).toBeEnabled();
    await act(async () => call.resolve({ id: 'p', hidden: true }));
    await waitFor(() => expect(moreButton(rowOf('Comentário pai'))).toBeEnabled());
  });

  it('depois de excluir, recarrega a lista uma vez com debounce de 5 s (fake timers): três exclusões seguidas geram um getPostComments a mais', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const three = [
      comment({ id: 'a', text: 'Comentário A' }),
      comment({ id: 'b', text: 'Comentário B' }),
      comment({ id: 'c', text: 'Comentário C' }),
      comment({ id: 'd', text: 'Comentário D' }),
    ];
    getPostCommentsMock
      .mockResolvedValueOnce(response({ comments: three }))
      .mockResolvedValue(response({ comments: [three[3]] }));
    deleteMock.mockImplementation((_c: number, _p: string, id: string) =>
      Promise.resolve({ id, deleted: true }),
    );
    renderPanel();
    await screen.findByText('Comentário A');

    await deleteVia('Comentário A');
    await act(() => vi.advanceTimersByTimeAsync(4000));
    await deleteVia('Comentário B');
    await act(() => vi.advanceTimersByTimeAsync(4000)); // 8 s desde a primeira: o timer foi reiniciado
    await deleteVia('Comentário C');
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(getPostCommentsMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(3);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    await waitFor(() => expect(getPostCommentsMock).toHaveBeenCalledTimes(2));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(getPostCommentsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Comentário D')).toBeInTheDocument();
  });

  it('comment_unavailable não apaga a linha localmente; recarrega a lista e mostra error.commentGone', async () => {
    const reload = deferred<PostCommentsResponse>();
    getPostCommentsMock
      .mockResolvedValueOnce(response({ comments: THREAD }))
      .mockReturnValueOnce(reload.promise);
    deleteMock.mockRejectedValueOnce(new CommentsApiError('comment_unavailable', 404));
    renderPanel();
    await screen.findByText('Outro comentário');
    await deleteVia('Outro comentário');

    expect(toastMock.error).toHaveBeenCalledWith(
      'Não foi possível encontrar esse comentário no Instagram. A lista foi atualizada.',
    );
    expect(toastMock).not.toHaveBeenCalled();
    // Recarga imediata, sem esperar o debounce; a linha segue até a lista nova chegar.
    await waitFor(() => expect(getPostCommentsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Outro comentário')).toBeInTheDocument();

    await act(async () =>
      reload.resolve(response({ comments: THREAD.filter((c) => c.id !== 'q') })),
    );
    await waitFor(() => expect(screen.queryByText('Outro comentário')).not.toBeInTheDocument());
    expect(screen.getByText('Comentário pai')).toBeInTheDocument();
  });

  it('recarga em segundo plano que falha mantém a lista e mostra moderation.refreshFailed', async () => {
    getPostCommentsMock
      .mockResolvedValueOnce(response({ comments: THREAD }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { client } = renderPanel();
    await screen.findByText('Comentário pai');
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['ig-post-comments', 42, 'ig-1'] });
    });
    expect(getPostCommentsMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não foi possível atualizar a lista agora.',
    );
    expect(screen.getByText('Comentário pai')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('compact usa ActionSheet em vez de DropdownMenu', async () => {
    getPostCommentsMock.mockResolvedValue(response({ comments: THREAD }));
    deleteMock.mockResolvedValue({ id: 'q', deleted: true });
    renderPanel(post(), true);
    await screen.findByText('Outro comentário');
    fireEvent.click(moreButton(rowOf('Outro comentário')));
    const sheet = await screen.findByRole('dialog', { name: 'Ações do comentário' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Ocultar comentário' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Excluir comentário' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Excluir comentário?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(42, 'ig-1', 'q'));
    await waitFor(() => expect(screen.queryByText('Outro comentário')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('resultado da recarga substitui o estado otimista', async () => {
    getPostCommentsMock.mockResolvedValueOnce(response({ comments: THREAD })).mockResolvedValueOnce(
      response({
        comments: [
          comment({ id: 'q', text: 'Outro comentário', hidden: true }),
          comment({ id: 'n', text: 'Comentário novo' }),
        ],
      }),
    );
    deleteMock.mockResolvedValue({ id: 'p', deleted: true });
    const { client } = renderPanel();
    await screen.findByText('Comentário pai');
    await deleteVia('Comentário pai');
    expect(screen.queryByText('Comentário pai')).not.toBeInTheDocument();

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['ig-post-comments', 42, 'ig-1'] });
    });
    expect(await screen.findByText('Comentário novo')).toBeInTheDocument();
    expect(rowOf('Outro comentário')).toHaveClass('igc-comment--hidden');
    expect(screen.getByText(/Mostrando 2 comentários/)).toBeInTheDocument();
  });
});
