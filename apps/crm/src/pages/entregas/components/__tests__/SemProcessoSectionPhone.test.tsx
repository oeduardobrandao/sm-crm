import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase');
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({ resolve: () => ({}), options: [] }),
}));
vi.mock('../PostStatusChip', () => ({
  PostStatusChip: ({ post }: { post: { status: string } }) => <span>{post.status}</span>,
}));
import { SemProcessoSection } from '../SemProcessoSection';
import type { ActivePost } from '../../../../store';

// jsdom's matchMedia reports no match: the phone rows.
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

describe('SemProcessoSection on phones', () => {
  it('lists rows with open, Aplicar processo and Ver todos', () => {
    const onPostClick = vi.fn();
    const onApplyProcess = vi.fn();
    const onVerTodos = vi.fn();
    render(
      <SemProcessoSection
        posts={[post(1), post(2)]}
        total={15}
        productionFiltersActive
        onPostClick={onPostClick}
        onApplyProcess={onApplyProcess}
        onVerTodos={onVerTodos}
      />,
    );
    expect(screen.getByRole('heading', { name: /Sem processo/ })).toHaveTextContent('15');
    expect(screen.getByText(/Filtros de produção/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Post 2/ }));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo em Post 1' }));
    expect(onApplyProcess).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(onPostClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    expect(onVerTodos).toHaveBeenCalled();
  });
});
