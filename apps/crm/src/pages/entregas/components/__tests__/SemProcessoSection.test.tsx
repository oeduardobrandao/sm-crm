import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase');
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({
    resolve: (p: { status: string }) => ({
      key: p.status,
      kind: 'canonical',
      canonical: p.status,
      label: p.status,
    }),
    options: [],
  }),
}));
vi.mock('../PostStatusChip', () => ({
  PostStatusChip: ({ post }: { post: { status: string } }) => <span>{post.status}</span>,
}));
import { SemProcessoSection } from '../SemProcessoSection';
import type { ActivePost } from '../../../../store';

const post = (id: number): ActivePost =>
  ({
    id,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    platform: 'instagram',
  }) as never;

describe('SemProcessoSection', () => {
  it('lista os posts, mostra o total e o link para Publicações; clique abre o post', () => {
    const onPostClick = vi.fn();
    const onVerTodos = vi.fn();
    render(
      <SemProcessoSection
        posts={[post(1), post(2)]}
        total={15}
        productionFiltersActive={false}
        onPostClick={onPostClick}
        onApplyProcess={vi.fn()}
        onVerTodos={onVerTodos}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sem processo' })).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post 2'));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos em Publicações' }));
    expect(onVerTodos).toHaveBeenCalled();
    expect(screen.queryByText(/Filtros de produção/)).toBeNull();
  });
  it('mostra o aviso de filtros de produção em vez de esconder a seção', () => {
    render(
      <SemProcessoSection
        posts={[post(1)]}
        total={1}
        productionFiltersActive
        onPostClick={vi.fn()}
        onApplyProcess={vi.fn()}
        onVerTodos={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Filtros de produção não se aplicam aos posts sem processo'),
    ).toBeInTheDocument();
  });
  it('sem nenhum post não renderiza nada', () => {
    const { container } = render(
      <SemProcessoSection
        posts={[]}
        total={0}
        productionFiltersActive={false}
        onPostClick={vi.fn()}
        onApplyProcess={vi.fn()}
        onVerTodos={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('cada card tem "Aplicar processo" que não abre o post', () => {
    const onPostClick = vi.fn();
    const onApplyProcess = vi.fn();
    const p = post(1);
    render(
      <SemProcessoSection
        posts={[p]}
        total={1}
        productionFiltersActive={false}
        onPostClick={onPostClick}
        onApplyProcess={onApplyProcess}
        onVerTodos={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    expect(onApplyProcess).toHaveBeenCalledWith(p);
    expect(onPostClick).not.toHaveBeenCalled();
  });
});
