import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/supabase');

const auth = vi.hoisted(() => ({
  role: 'owner',
  workspaceRole: 'owner' as string | null,
  membershipResolved: true as boolean | 'error',
}));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ ...auth }) }));

const membroMock = vi.hoisted(() => ({
  membro: null as { id: number; nome: string } | null,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
}));
vi.mock('../../../../hooks/useCurrentMembro', () => ({
  useCurrentMembro: () => ({ ...membroMock }),
}));

const dataMock = vi.hoisted(() => ({
  cards: [] as unknown[],
  posts: [] as unknown[],
  postEntities: [] as unknown[],
  isLoading: false,
  isError: false,
  enabledSeen: null as boolean | null,
}));
vi.mock('../../../entregas/hooks/useMinhaFilaData', () => ({
  useMinhaFilaData: ({ enabled }: { enabled: boolean }) => {
    dataMock.enabledSeen = enabled;
    return { ...dataMock };
  },
}));

const captureEvent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ captureEvent }));

import { MinhaFilaCard } from '../MinhaFilaCard';

const ME = 7;
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

function fluxoCard(id: number) {
  const etapa = {
    id: id * 100,
    workflow_id: id,
    ordem: 0,
    nome: 'Design',
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    responsavel_id: ME,
    tipo: 'padrao',
    status: 'ativo',
    iniciado_em: null,
    data_limite: tomorrow,
  };
  return {
    workflow: { id, titulo: `Fluxo ${id}`, cliente_id: 1, status: 'ativo', etapa_atual: 0 },
    etapa,
    cliente: { id: 1, nome: 'Dra. Marina' },
    membro: { id: ME, nome: 'Ana' },
    deadline: { diasRestantes: 1, horasRestantes: 4, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [etapa],
  };
}

function post(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    workflow_id: 1,
    cliente_id: 1,
    cliente_nome: 'Dra. Marina',
    workflow_titulo: 'Fluxo 1',
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    responsavel_id: null,
    platform: 'instagram',
    ...over,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <MinhaFilaCard />
    </MemoryRouter>,
  );
}

describe('MinhaFilaCard', () => {
  beforeEach(() => {
    auth.role = 'owner';
    auth.workspaceRole = 'owner';
    auth.membershipResolved = true;
    membroMock.membro = { id: ME, nome: 'Ana' };
    membroMock.isLoading = false;
    membroMock.isPending = false;
    membroMock.isError = false;
    membroMock.isSuccess = true;
    dataMock.cards = [];
    dataMock.posts = [];
    dataMock.postEntities = [];
    dataMock.isLoading = false;
    dataMock.isError = false;
    dataMock.enabledSeen = null;
    captureEvent.mockReset();
  });

  it('without a linked membro shows the link card: /equipe link for owner/admin, none for agent', () => {
    membroMock.membro = null;
    const owner = renderCard();
    expect(screen.getByText('Minha fila')).toBeInTheDocument();
    expect(
      screen.getByText('Vincule seu usuário a um membro da equipe para ver sua fila aqui.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vincular na Equipe' })).toHaveAttribute(
      'href',
      '/equipe',
    );
    expect(dataMock.enabledSeen).toBe(false);
    owner.unmount();

    auth.workspaceRole = 'agent';
    renderCard();
    expect(
      screen.getByText('Peça a um administrador para vincular seu usuário na página Equipe.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vincular na Equipe' })).not.toBeInTheDocument();
  });

  it('lists the first three items with view=fila deep links and the "+n na fila" line', () => {
    dataMock.cards = [fluxoCard(1)];
    dataMock.posts = [
      post(1, { scheduled_at: new Date(2030, 0, 3, 10).toISOString() }),
      post(2, { scheduled_at: new Date(2030, 0, 1, 10).toISOString() }),
      post(3),
      post(4, {
        workflow_id: null,
        workflow_titulo: null,
        responsavel_id: ME,
        scheduled_at: new Date(2030, 0, 2, 10).toISOString(),
      }),
    ];
    renderCard();
    expect(dataMock.enabledSeen).toBe(true);
    const links = screen.getAllByRole('link').filter((l) => /^Post \d/.test(l.textContent ?? ''));
    expect(links.map((l) => l.textContent?.slice(0, 6))).toEqual(['Post 2', 'Post 1', 'Post 3']);
    expect(links[0]).toHaveAttribute('href', '/entregas?view=fila&drawer=1&post=2');
    expect(screen.getByText('+1 na fila')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver minha fila/ })).toHaveAttribute(
      'href',
      '/entregas?view=fila',
    );
    expect(screen.getAllByText('1d restantes').length).toBeGreaterThan(0);
    expect(screen.getByText('sem data de publicação')).toBeInTheDocument();
  });

  it('links an avulso through the universal ?post= form', () => {
    dataMock.posts = [
      post(4, {
        workflow_id: null,
        workflow_titulo: null,
        responsavel_id: ME,
        scheduled_at: new Date(2030, 0, 2, 10).toISOString(),
      }),
    ];
    renderCard();
    expect(screen.getByRole('link', { name: /Post 4/ })).toHaveAttribute(
      'href',
      '/entregas?view=fila&post=4',
    );
  });

  it('captures the teaser clicks', () => {
    dataMock.cards = [fluxoCard(1)];
    dataMock.posts = [post(1)];
    renderCard();
    fireEvent.click(screen.getByRole('link', { name: /Post 1/ }));
    expect(captureEvent).toHaveBeenCalledWith(
      'minha_fila_teaser_clicked',
      { target: 'item', position: 0 },
      { sendInstantly: true },
    );
    fireEvent.click(screen.getByRole('link', { name: /Ver minha fila/ }));
    expect(captureEvent).toHaveBeenCalledWith(
      'minha_fila_teaser_clicked',
      { target: 'ver_fila' },
      { sendInstantly: true },
    );
  });

  it('renders empty, loading and error states', () => {
    const empty = renderCard();
    expect(screen.getByText('Nada na sua fila.')).toBeInTheDocument();
    empty.unmount();

    dataMock.isLoading = true;
    const loading = renderCard();
    expect(loading.container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('Nada na sua fila.')).not.toBeInTheDocument();
    loading.unmount();

    dataMock.isLoading = false;
    dataMock.isError = true;
    const failed = renderCard();
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
    failed.unmount();

    dataMock.isError = false;
    membroMock.isError = true;
    renderCard();
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
  });

  it('shows the spinner (not the vincule card) on a paused/offline cold start for a linked user', () => {
    // isPending=true, isLoading=false, membro=null: mirrors TanStack's own
    // isLoading = isPending && isFetching -- a paused query is pending but not
    // fetching, so isLoading is false even though there is no membro yet. Reading
    // isLoading (as round-1 code did) would wrongly fall through to "vincule seu
    // usuário" for a user who IS linked.
    membroMock.membro = null;
    membroMock.isLoading = false;
    membroMock.isPending = true;
    renderCard();
    expect(screen.getByText('Minha fila')).toBeInTheDocument();
    expect(
      screen.queryByText('Vincule seu usuário a um membro da equipe para ver sua fila aqui.'),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows the rows for a cached membro even after a failed background refetch', () => {
    // isPending=false (cached data present), isError=false (isLoadingError
    // semantics: a failed refetch with cached data is NOT isLoadingError), membro
    // set: the card must render normally, not spin or show an error.
    membroMock.membro = { id: ME, nome: 'Ana' };
    membroMock.isPending = false;
    membroMock.isError = false;
    dataMock.cards = [fluxoCard(1)];
    dataMock.posts = [post(1)];
    renderCard();
    expect(screen.getByRole('link', { name: /Post 1/ })).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(
      screen.queryByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).not.toBeInTheDocument();
  });

  it('shows the error, not the spinner, when a query failed while a sibling is still loading', () => {
    // The loading branch must not win over the error branch, or a failed query
    // with no data alongside a paused sibling would spin the card forever.
    dataMock.isError = true;
    dataMock.isLoading = true;
    renderCard();
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('shows the vincule card, not the error, when no membro is linked but a stale data-level error survives', () => {
    // Fix round 2: even though the real useMinhaFilaData now gates isError by
    // `enabled` (so this shouldn't happen end-to-end), the card itself also
    // gates `data.isError` on `membroId != null` -- symmetric with how it
    // already gates `data.isLoading` -- as defense in depth against a stale
    // error surviving on a shared cache key while unlinked.
    membroMock.membro = null;
    dataMock.isError = true;
    renderCard();
    expect(
      screen.getByText('Vincule seu usuário a um membro da equipe para ver sua fila aqui.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).not.toBeInTheDocument();
  });

  it('still shows the error for a membro-level error even with no membro resolved yet', () => {
    // useCurrentMembro().isError is never gated: without the membros list we
    // can't know whether the user is linked at all, so it must always win over
    // the no-membro branch.
    membroMock.membro = null;
    membroMock.isError = true;
    renderCard();
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Vincule seu usuário a um membro da equipe para ver sua fila aqui.'),
    ).not.toBeInTheDocument();
  });
});
