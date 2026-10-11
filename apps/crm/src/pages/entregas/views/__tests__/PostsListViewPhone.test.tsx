import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});
vi.mock('@/lib/copyAppLink', () => ({ copyAppLink: vi.fn() }));

import { copyAppLink } from '@/lib/copyAppLink';
import { LONG_PRESS_MS } from '@/components/mobile/useLongPress';
import { installPointerEvent, pointerDown, pointerUp } from '@/components/mobile/__tests__/pointer';
import { PostsListView } from '../PostsListView';
import type { ActivePost } from '@/store';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { PostEntity } from '../../boardEntity';
import { PhoneBoardActionsContext, type PhoneBoardActions } from '../../phone/boardActions';

// jsdom's matchMedia reports false, so PostsListView renders its phone branch here.

beforeAll(installPointerEvent);
afterEach(() => {
  vi.useRealTimers();
});

let nextId = 1;
function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: nextId++,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo Base',
    titulo: 'Post Base',
    tipo: 'feed',
    status: 'rascunho',
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...overrides,
  };
}

function makeBoardCard(overrides: Record<string, unknown> = {}): BoardCard {
  return {
    workflow: { id: 10, titulo: 'Fluxo Base' },
    etapa: { id: 1, nome: 'Design' },
    membro: { id: 7, nome: 'Ana Silva' },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' },
    clienteAvatarUrl: undefined,
    deadline: { estourado: false, urgente: false, diasRestantes: 2, horasRestantes: 0 },
    etapaIdx: 1,
    totalEtapas: 3,
    allEtapas: [],
    ...overrides,
  } as unknown as BoardCard;
}

function makeEntity(postId: number, etapaNome = 'Copy'): PostEntity {
  const steps = [
    { ordem: 1, nome: etapaNome, estado: 'ativo' },
    { ordem: 2, nome: 'Revisão', estado: 'pendente' },
  ];
  return {
    kind: 'post',
    id: `post:${postId}`,
    process: { id: postId, post_id: postId, etapa_atual: 1, steps } as never,
    step: { ordem: 1, nome: etapaNome, responsavel_id: 42, estado: 'ativo' } as never,
    templateId: null,
    steps: steps as never,
    etapaOrdem: 1,
    etapaNome,
    responsavel: { id: 42, nome: 'Bia' } as never,
    prazoEfetivo: null,
    posicao: 0,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: 'Post individual',
  };
}

function makeActions(overrides: Partial<PhoneBoardActions> = {}): PhoneBoardActions {
  return {
    membros: [],
    onRefresh: vi.fn(),
    countsFor: () => ({
      postsCount: 1,
      approvedPostsCount: 0,
      clearedClienteCount: 0,
      revisaoInternaCount: 0,
      awaitingClienteCount: 0,
    }),
    workflow: { open: vi.fn(), edit: vi.fn(), forward: vi.fn(), revert: vi.fn() },
    post: { open: vi.fn(), forward: vi.fn(), revert: vi.fn(), removeProcess: vi.fn() },
    openPost: vi.fn(),
    cardOfPost: vi.fn(),
    entityOfPost: vi.fn(),
    ...overrides,
  };
}

const card = makeBoardCard();
const baseProps = {
  isLoading: false,
  openableWorkflowIds: new Set([10]),
  onPostClick: vi.fn(),
  onFluxoClick: vi.fn(),
  cardsByWorkflowId: new Map([[10, card]]),
  filtersActive: true,
  onCreateAvulso: vi.fn(),
};

function renderList(ui: ReactNode, actions: PhoneBoardActions | null = makeActions()) {
  render(
    <MemoryRouter>
      <PhoneBoardActionsContext.Provider value={actions}>{ui}</PhoneBoardActionsContext.Provider>
    </MemoryRouter>,
  );
  return actions;
}

const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

describe('PostsListView no celular', () => {
  it('linhas agrupadas pela data de postagem, com cliente · etapa · responsável e status', () => {
    const today = new Date();
    today.setHours(23, 0, 0, 0);
    renderList(
      <PostsListView
        {...baseProps}
        groupBy="postagem"
        posts={[
          makePost({ titulo: 'Hoje', scheduled_at: today.toISOString() }),
          makePost({ titulo: 'Sem data', status: 'aprovado_cliente' }),
        ]}
      />,
    );
    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hoje (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sem data (1)' })).toBeInTheDocument();
    const row = within(rowOf('Hoje'));
    expect(row.getByText('Aurora · Design · Ana Silva')).toBeInTheDocument();
    expect(row.getByText('2d restantes')).toBeInTheDocument();
    expect(row.getByText(/^Fluxo Base · Imagem · Agendado/)).toBeInTheDocument();
    expect(row.getByText('Rascunho')).toBeInTheDocument();
  });

  it('mantém os estados vazios, inclusive o aviso dos postados ocultos', () => {
    renderList(<PostsListView {...baseProps} posts={[]} hiddenPostados={2} />);
    expect(
      screen.getByText('Nenhum post a mostrar. 2 posts postados estão ocultos.'),
    ).toBeInTheDocument();
  });

  it('toque abre o post só quando o fluxo é abrível', () => {
    const onPostClick = vi.fn();
    const aberto = makePost({ titulo: 'Abrível' });
    const fechado = makePost({ titulo: 'Fechado', workflow_id: 99, workflow_titulo: 'Outro' });
    renderList(
      <PostsListView {...baseProps} onPostClick={onPostClick} posts={[aberto, fechado]} />,
    );
    fireEvent.click(screen.getByText('Abrível'));
    expect(onPostClick).toHaveBeenCalledWith(aberto);
    fireEvent.click(screen.getByText('Fechado'));
    expect(onPostClick).toHaveBeenCalledTimes(1);
  });

  it('post amarrado: Avançar avança a etapa do fluxo; o menu abre o fluxo pelo onFluxoClick', () => {
    const post = makePost({ titulo: 'Amarrado' });
    const onFluxoClick = vi.fn();
    const actions = renderList(
      <PostsListView {...baseProps} onFluxoClick={onFluxoClick} posts={[post]} />,
      makeActions({ cardOfPost: vi.fn(() => card) }),
    )!;
    fireEvent.click(within(rowOf('Amarrado')).getByRole('button', { name: 'Avançar' }));
    expect(actions.workflow.forward).toHaveBeenCalledWith(card);

    fireEvent.click(within(rowOf('Amarrado')).getByRole('button', { name: 'Mais' }));
    const menu = screen.getByRole('menu', { name: 'Ações do post' });
    expect(
      within(menu).getByRole('menuitem', { name: 'Concluir etapa e avançar' }),
    ).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Voltar etapa' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Abrir fluxo' }));
    expect(onFluxoClick).toHaveBeenCalledWith(10);
  });

  it('avulso com processo: Avançar avança o processo; Voltar só com etapa anterior', () => {
    const post = makePost({ titulo: 'Avulso', workflow_id: null, workflow_titulo: null });
    const entity = makeEntity(post.id);
    const actions = renderList(
      <PostsListView
        {...baseProps}
        posts={[post]}
        postEntityByPostId={new Map([[post.id, entity]])}
      />,
      makeActions({ entityOfPost: vi.fn(() => entity) }),
    )!;
    expect(within(rowOf('Avulso')).getByText('Aurora · Copy · Bia')).toBeInTheDocument();
    fireEvent.click(within(rowOf('Avulso')).getByRole('button', { name: 'Avançar' }));
    expect(actions.post.forward).toHaveBeenCalledWith(entity);

    fireEvent.click(within(rowOf('Avulso')).getByRole('button', { name: 'Mais' }));
    const menu = screen.getByRole('menu', { name: 'Ações do post' });
    expect(within(menu).getByRole('menuitem', { name: 'Avançar etapa' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Voltar etapa' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Abrir fluxo' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copiar link do post' }));
    expect(copyAppLink).toHaveBeenCalledWith(`/entregas?post=${post.id}`);
  });

  it('avulso sem processo: sem Avançar, Mais ainda abre o menu', () => {
    const onPostClick = vi.fn();
    const post = makePost({ titulo: 'Solto', workflow_id: null, workflow_titulo: null });
    renderList(<PostsListView {...baseProps} onPostClick={onPostClick} posts={[post]} />);
    const row = within(rowOf('Solto'));
    expect(row.queryByRole('button', { name: 'Avançar' })).toBeNull();
    fireEvent.click(row.getByRole('button', { name: 'Mais' }));
    const menu = screen.getByRole('menu', { name: 'Ações do post' });
    expect(within(menu).queryByRole('menuitem', { name: /avançar|Concluir/i })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Abrir post' }));
    expect(onPostClick).toHaveBeenCalledWith(post);
  });

  it('segurar a linha abre o menu sem abrir o post', () => {
    vi.useFakeTimers();
    const onPostClick = vi.fn();
    renderList(
      <PostsListView
        {...baseProps}
        onPostClick={onPostClick}
        posts={[makePost({ titulo: 'Segurar' })]}
      />,
    );
    const target = screen.getByText('Segurar');
    pointerDown(target, { x: 20, y: 20 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    });
    expect(screen.getByRole('menu', { name: 'Ações do post' })).toBeInTheDocument();
    pointerUp(target, { x: 20, y: 20 });
    fireEvent.click(target);
    expect(onPostClick).not.toHaveBeenCalled();
  });

  it('sem as ações da página não há ações de deslizar', () => {
    renderList(<PostsListView {...baseProps} posts={[makePost({ titulo: 'Sem ações' })]} />, null);
    const row = within(rowOf('Sem ações'));
    expect(row.queryByRole('button', { name: 'Mais' })).toBeNull();
    expect(row.queryByRole('button', { name: 'Avançar' })).toBeNull();
  });
});
