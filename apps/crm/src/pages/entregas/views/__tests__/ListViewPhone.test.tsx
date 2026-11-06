import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Canonical-only registry, without TanStack Query (the post card preview reads it).
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

import { toLocalISODate } from '@/utils/postDate';
import { LONG_PRESS_MS } from '@/components/mobile/useLongPress';
import {
  installPointerEvent,
  pointerDown,
  pointerMove,
  pointerUp,
} from '@/components/mobile/__tests__/pointer';
import { ListView } from '../ListView';
import type { PostEntity } from '../../boardEntity';
import type { BoardCard } from '../../hooks/useEntregasData';
import { PhoneBoardActionsContext, type PhoneBoardActions } from '../../phone/boardActions';

// jsdom's matchMedia reports false, so ListView renders its phone branch here.

beforeAll(installPointerEvent);
afterEach(() => {
  vi.useRealTimers();
});

const isoDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toLocalISODate(d);
};

function makeCard(overrides: Record<string, unknown> = {}): BoardCard {
  return {
    workflow: { id: 1, titulo: 'Fluxo Base' },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' },
    etapa: { id: 11, nome: 'Briefing', tipo: 'padrao', ordem: 0 },
    membro: { id: 7, nome: 'Ana' },
    deadline: { estourado: false, urgente: false, diasRestantes: 3, horasRestantes: 48 },
    totalEtapas: 3,
    etapaIdx: 1,
    allEtapas: [],
    ...overrides,
  } as unknown as BoardCard;
}

function makeEntity(titulo: string): PostEntity {
  const steps = [
    { ordem: 1, nome: 'Copy', estado: 'concluido' },
    { ordem: 2, nome: 'Design', estado: 'ativo', responsavel_id: 2 },
    { ordem: 3, nome: 'Revisão', estado: 'pendente' },
  ];
  return {
    kind: 'post',
    id: 'post:9',
    process: {
      id: 9,
      post_id: 90,
      etapa_atual: 2,
      steps,
      post: {
        id: 90,
        titulo,
        tipo: 'feed',
        status: 'rascunho',
        cliente_id: 1,
        cliente_nome: 'Aurora',
      },
    } as never,
    step: steps[1] as never,
    templateId: null,
    steps: steps.map((s) => ({ ordem: s.ordem, nome: s.nome, tipo: 'padrao' })) as never,
    etapaOrdem: 2,
    etapaNome: 'Design',
    responsavel: { id: 2, nome: 'Bia' } as never,
    prazoEfetivo: new Date(),
    posicao: 0,
    deadline: { diasRestantes: 0, horasRestantes: 5, estourado: false, urgente: true },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' } as never,
    titulo,
  };
}

function makeActions(): PhoneBoardActions {
  return {
    membros: [],
    onRefresh: vi.fn(),
    countsFor: () => ({
      postsCount: 2,
      approvedPostsCount: 0,
      clearedClienteCount: 0,
      revisaoInternaCount: 0,
      awaitingClienteCount: 0,
    }),
    workflow: {
      open: vi.fn(),
      edit: vi.fn(),
      forward: vi.fn(),
      revert: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
    },
    post: {
      open: vi.fn(),
      forward: vi.fn(),
      revert: vi.fn(),
      removeProcess: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
    },
    openPost: vi.fn(),
    cardOfPost: vi.fn(),
    entityOfPost: vi.fn(),
  };
}

function renderList(
  ui: ReactNode,
  actions: PhoneBoardActions | null = makeActions(),
): PhoneBoardActions | null {
  render(
    <MemoryRouter>
      <PhoneBoardActionsContext.Provider value={actions}>{ui}</PhoneBoardActionsContext.Provider>
    </MemoryRouter>,
  );
  return actions;
}

const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
const sort = { column: 'titulo', direction: 'asc' as const };

describe('ListView no celular', () => {
  it('troca a tabela por linhas agrupadas pelo prazo, na ordem da tabela dentro do grupo', () => {
    const cards = [
      makeCard({
        workflow: { id: 1, titulo: 'Zeta' },
        etapa: { id: 11, nome: 'Copy', data_limite: isoDay(-2) },
        deadline: { estourado: true, urgente: false, diasRestantes: -2, horasRestantes: 0 },
      }),
      makeCard({
        workflow: { id: 2, titulo: 'Alfa' },
        etapa: { id: 12, nome: 'Copy', data_limite: isoDay(-1) },
        deadline: { estourado: true, urgente: false, diasRestantes: -1, horasRestantes: 0 },
      }),
      makeCard({ workflow: { id: 3, titulo: 'Beta' }, etapa: { id: 13, nome: 'Design' } }),
    ];
    renderList(
      <ListView
        cards={cards}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        groupBy="prazo"
      />,
    );
    expect(document.querySelector('table')).toBeNull();
    expect(
      screen.getAllByRole('button', { expanded: true }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Atrasado (2)', 'Sem prazo (1)']);
    const atrasado = screen.getByRole('list', { name: 'Entregas: Atrasado' });
    expect(
      within(atrasado)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('strong')?.textContent),
    ).toEqual(['Alfa', 'Zeta']);
    expect(within(rowOf('Alfa')).getByText('Aurora · Copy · Ana')).toBeInTheDocument();
    expect(within(rowOf('Alfa')).getByText('1d atrasado')).toBeInTheDocument();
    expect(within(rowOf('Alfa')).getByText('Atrasado')).toBeInTheDocument();
    expect(within(rowOf('Beta')).getByText('3d restantes')).toBeInTheDocument();
    expect(within(rowOf('Beta')).getByText('Em dia')).toBeInTheDocument();
  });

  it('recolhe um grupo, e Fechar todos / Abrir todos só no primeiro cabeçalho', () => {
    const cards = [
      makeCard({
        workflow: { id: 1, titulo: 'Fluxo da Ana' },
        etapa: { id: 11, nome: 'Copy', responsavel_id: 7 },
      }),
      makeCard({
        workflow: { id: 2, titulo: 'Fluxo sem dono' },
        etapa: { id: 12, nome: 'Copy' },
        membro: undefined,
      }),
    ];
    renderList(
      <ListView
        cards={cards}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        groupBy="responsavel"
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Fechar todos' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ana (1)' }));
    expect(screen.queryByText('Fluxo da Ana')).toBeNull();
    expect(screen.getByText('Fluxo sem dono')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar todos' }));
    expect(screen.queryByText('Fluxo sem dono')).toBeNull();
    expect(screen.queryAllByRole('list')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir todos' }));
    expect(screen.getByText('Fluxo da Ana')).toBeInTheDocument();
    expect(screen.getByText('Fluxo sem dono')).toBeInTheDocument();
  });

  it('sem agrupamento é um cartão só, sem cabeçalhos; o estado vazio é o mesmo', () => {
    renderList(
      <ListView
        cards={[
          makeCard({ workflow: { id: 1, titulo: 'B' } }),
          makeCard({ workflow: { id: 2, titulo: 'A' } }),
        ]}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Fechar todos' })).toBeNull();
    expect(
      screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent),
    ).toEqual(['A', 'B']);
  });

  it('mostra o estado vazio da tabela', () => {
    renderList(<ListView cards={[]} sort={sort} onSortChange={vi.fn()} onCardClick={vi.fn()} />);
    expect(screen.getByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeInTheDocument();
  });

  it('toque abre o fluxo e o post individual pelos mesmos handlers da tabela', () => {
    const onCardClick = vi.fn();
    const onPostClick = vi.fn();
    const card = makeCard({ workflow: { id: 1, titulo: 'Fluxo X' } });
    const entity = makeEntity('Post Z');
    renderList(
      <ListView
        cards={[card]}
        postEntities={[entity]}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={onCardClick}
        onPostClick={onPostClick}
      />,
    );
    fireEvent.click(screen.getByText('Fluxo X'));
    expect(onCardClick).toHaveBeenCalledWith(card);
    fireEvent.click(screen.getByText('Post Z'));
    expect(onPostClick).toHaveBeenCalledWith(entity);
    expect(within(rowOf('Post Z')).getByText('Individual')).toBeInTheDocument();
  });

  it('Avançar no fluxo avança a etapa do fluxo; no post individual, o processo', () => {
    const card = makeCard({ workflow: { id: 1, titulo: 'Fluxo X' } });
    const entity = makeEntity('Post Z');
    const actions = renderList(
      <ListView
        cards={[card]}
        postEntities={[entity]}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        onPostClick={vi.fn()}
      />,
    )!;
    const fluxoRow = within(rowOf('Fluxo X'));
    expect(fluxoRow.getByRole('button', { name: 'Mais' })).toBeInTheDocument();
    fireEvent.click(fluxoRow.getByRole('button', { name: 'Avançar' }));
    expect(actions.workflow.forward).toHaveBeenCalledWith(card);

    fireEvent.click(within(rowOf('Post Z')).getByRole('button', { name: 'Avançar' }));
    expect(actions.post.forward).toHaveBeenCalledWith(entity);
  });

  it('Mais abre o menu do fluxo com as ações do card', () => {
    const card = makeCard({ workflow: { id: 1, titulo: 'Fluxo X' } });
    const actions = renderList(
      <ListView cards={[card]} sort={sort} onSortChange={vi.fn()} onCardClick={vi.fn()} />,
    )!;
    fireEvent.click(within(rowOf('Fluxo X')).getByRole('button', { name: 'Mais' }));
    const menu = screen.getByRole('menu', { name: 'Ações do fluxo' });
    expect(within(menu).getByRole('menuitem', { name: 'Voltar etapa' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Duplicar fluxo' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Editar' }));
    expect(actions.workflow.edit).toHaveBeenCalledWith(card);
  });

  it('Mais abre o menu do post individual: avançar, voltar e encerrar processo', () => {
    const entity = makeEntity('Post Z');
    const actions = renderList(
      <ListView
        cards={[]}
        postEntities={[entity]}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        onPostClick={vi.fn()}
      />,
    )!;
    fireEvent.click(within(rowOf('Post Z')).getByRole('button', { name: 'Mais' }));
    const menu = screen.getByRole('menu', { name: 'Ações do post' });
    expect(within(menu).getByRole('menuitem', { name: 'Avançar etapa' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Voltar etapa' }));
    expect(actions.post.revert).toHaveBeenCalledWith(entity);
    fireEvent.click(within(rowOf('Post Z')).getByRole('button', { name: 'Mais' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar processo' }));
    expect(actions.post.removeProcess).toHaveBeenCalledWith(entity);
  });

  it('Mais abre o menu com a linha já aberta (por foco ou depois de deslizar)', () => {
    const card = makeCard({ workflow: { id: 1, titulo: 'Fluxo X' } });
    const actions = renderList(
      <ListView cards={[card]} sort={sort} onSortChange={vi.fn()} onCardClick={vi.fn()} />,
    )!;
    const row = rowOf('Fluxo X');
    const mais = within(row).getByRole('button', { name: 'Mais' });

    // Foco no botão (teclado) abre o lado das ações antes do clique.
    fireEvent.focus(mais);
    expect(row).toHaveAttribute('data-open', 'trailing');
    fireEvent.click(mais);
    expect(screen.getByRole('menu', { name: 'Ações do fluxo' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    // Deslizar de verdade: o clique que segue o gesto não chega, e Mais ainda abre o menu.
    const content = row.querySelector('.phone-swipe-row__content') as HTMLElement;
    pointerDown(content, { x: 200, y: 10 });
    pointerMove(content, { x: 100, y: 10 });
    pointerUp(content, { x: 40, y: 10 });
    expect(row).toHaveAttribute('data-open', 'trailing');
    fireEvent.click(mais);
    const item = screen.getByRole('menuitem', { name: 'Concluir etapa e avançar' });
    // No navegador o pointerdown sempre vem antes do clique.
    pointerDown(item, { x: 10, y: 10 });
    pointerUp(item, { x: 10, y: 10 });
    fireEvent.click(item);
    expect(actions.workflow.forward).toHaveBeenCalledWith(card);
  });

  it('segurar a linha abre o menu e não abre o fluxo', () => {
    vi.useFakeTimers();
    const onCardClick = vi.fn();
    renderList(
      <ListView
        cards={[makeCard({ workflow: { id: 1, titulo: 'Fluxo X' } })]}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={onCardClick}
      />,
    );
    const target = screen.getByText('Fluxo X');
    pointerDown(target, { x: 20, y: 20 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    });
    expect(screen.getByRole('menu', { name: 'Ações do fluxo' })).toBeInTheDocument();
    pointerUp(target, { x: 20, y: 20 });
    fireEvent.click(target);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('sem as ações da página não há ações de deslizar', () => {
    renderList(
      <ListView
        cards={[makeCard({ workflow: { id: 1, titulo: 'Fluxo X' } })]}
        sort={sort}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
      null,
    );
    expect(within(rowOf('Fluxo X')).queryByRole('button', { name: 'Avançar' })).toBeNull();
    expect(within(rowOf('Fluxo X')).queryByRole('button', { name: 'Mais' })).toBeNull();
  });
});
