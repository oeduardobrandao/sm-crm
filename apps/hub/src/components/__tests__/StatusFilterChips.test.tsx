import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusFilterChips } from '../StatusFilterChips';

describe('StatusFilterChips', () => {
  it('renders Todos plus the three client statuses with live counts and reports clicks', () => {
    const onChange = vi.fn();
    render(
      <StatusFilterChips
        value="all"
        counts={{ all: 6, enviado_cliente: 2, correcao_cliente: 1, aprovado_cliente: 3 }}
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('group', { name: 'Filtrar por status' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos (6)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Aguardando aprovação (2)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Correção solicitada (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovado (3)' })).toBeInTheDocument();
    expect(screen.queryByText(/Rejeitado/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Correção solicitada (1)' }));
    expect(onChange).toHaveBeenCalledWith('correcao_cliente');
  });

  it('lets a parent fold the group into its own flex row via className', () => {
    render(
      <StatusFilterChips
        value="all"
        counts={{ all: 1, enviado_cliente: 1, correcao_cliente: 0, aprovado_cliente: 0 }}
        onChange={vi.fn()}
        className="contents"
      />,
    );
    const group = screen.getByRole('group', { name: 'Filtrar por status' });
    expect(group.className).toBe('contents');
    expect(group.className).not.toContain('mb-6');
  });
});
