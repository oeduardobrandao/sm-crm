import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ListView } from '../ListView';
import type { PostEntity } from '../../boardEntity';

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    workflow: {
      id: 1,
      titulo: 'Fluxo Base',
    },
    cliente: {
      id: 1,
      nome: 'Aurora',
      cor: '#0f766e',
    },
    etapa: {
      id: 11,
      nome: 'Briefing',
    },
    membro: {
      id: 7,
      nome: 'Ana',
    },
    deadline: {
      estourado: false,
      urgente: false,
      diasRestantes: 3,
      horasRestantes: 48,
    },
    totalEtapas: 3,
    etapaIdx: 0,
    allEtapas: [],
    ...overrides,
  } as any;
}

function getRenderedTitles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent,
  );
}

describe('ListView', () => {
  it('renders the empty state when no cards match the filters', () => {
    render(
      <ListView
        cards={[]}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeInTheDocument();
  });

  it('formats deadlines and statuses, lets the user sort, and opens a card on row click', () => {
    const onSortChange = vi.fn();
    const onCardClick = vi.fn();
    const cards = [
      makeCard({
        workflow: { id: 1, titulo: 'Beta' },
        cliente: { id: 2, nome: 'Beta Labs', cor: '#2563eb' },
        deadline: { estourado: true, urgente: false, diasRestantes: -1, horasRestantes: 0 },
      }),
      makeCard({
        workflow: { id: 2, titulo: 'Alpha' },
        cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' },
        deadline: { estourado: false, urgente: true, diasRestantes: 0, horasRestantes: 12 },
      }),
      makeCard({
        workflow: { id: 3, titulo: 'Gamma' },
        cliente: { id: 3, nome: 'Clara', cor: '#9333ea' },
        deadline: { estourado: false, urgente: false, diasRestantes: 3, horasRestantes: 48 },
      }),
    ];

    const { container } = render(
      <ListView
        cards={cards}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={onSortChange}
        onCardClick={onCardClick}
      />,
    );

    expect(getRenderedTitles(container)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(screen.getByText('1d atrasado')).toBeInTheDocument();
    expect(screen.getByText('12h restantes')).toBeInTheDocument();
    expect(screen.getByText('3d restantes')).toBeInTheDocument();
    expect(screen.getByText('Atrasado')).toBeInTheDocument();
    expect(screen.getByText('Urgente')).toBeInTheDocument();
    expect(screen.getByText('Em dia')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cliente'));
    expect(onSortChange).toHaveBeenCalledWith({ column: 'cliente', direction: 'asc' });

    fireEvent.click(screen.getByText('Alpha'));
    expect(onCardClick).toHaveBeenCalledWith(cards[1]);
  });

  it('toggles descending sort when the active column header is clicked again', () => {
    const onSortChange = vi.fn();

    render(
      <ListView
        cards={[makeCard()]}
        sort={{ column: 'cliente', direction: 'asc' }}
        onSortChange={onSortChange}
        onCardClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Cliente'));

    expect(onSortChange).toHaveBeenCalledWith({ column: 'cliente', direction: 'desc' });
  });
});

function makePostEntity(titulo: string, dias: number): PostEntity {
  return {
    kind: 'post',
    id: 'post:9',
    process: { id: 9, post_id: 90 } as never,
    step: {} as never,
    templateId: null,
    steps: [],
    etapaOrdem: 0,
    etapaNome: 'Copy',
    responsavel: { id: 2, nome: 'Bia' } as never,
    prazoEfetivo: null,
    posicao: 0,
    deadline: { diasRestantes: dias, horasRestantes: 0, estourado: false, urgente: false },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' } as never,
    titulo,
  };
}

describe('ListView com posts individuais', () => {
  it('lista o post com a tag Individual, etapa e responsável da etapa, e abre pelo onPostClick', () => {
    const onPostClick = vi.fn();
    render(
      <ListView
        cards={[makeCard() as never]}
        postEntities={[makePostEntity('Post Z', 1)]}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        onPostClick={onPostClick}
      />,
    );
    expect(screen.getByText('Individual')).toBeInTheDocument();
    expect(screen.getByText('Bia')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post Z'));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'post:9' }));
  });

  it('ordena fluxos e posts juntos por prazo', () => {
    render(
      <ListView
        cards={[makeCard() as never]} // 3d restantes
        postEntities={[makePostEntity('Post Z', 1)]}
        sort={{ column: 'prazo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Post Z');
    expect(rows[1]).toHaveTextContent('Fluxo Base');
  });

  it('sem cards mas com posts não mostra o estado vazio', () => {
    render(
      <ListView
        cards={[]}
        postEntities={[makePostEntity('Post Z', 1)]}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
    );
    expect(screen.queryByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeNull();
  });

  it('mostra "Sem prazo" para um post sem prazo efetivo, em vez de "0h restantes"', () => {
    // prazoEfetivo null + deadline zerado (fallback de deadlineFromPrazoEfetivo):
    // exatamente o estado de uma etapa não ativada ou com prazo limpo.
    render(
      <ListView
        cards={[]}
        postEntities={[makePostEntity('Post Sem Prazo', 0)]}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
    );
    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
    expect(screen.queryByText('0h restantes')).toBeNull();
  });
});
