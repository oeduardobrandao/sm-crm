import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HealthFilterBar } from '../HealthFilterBar';

const summary = { total: 8, atencao: 3, saudaveis: 3, estaveis: 1, conexao: 1, precisamAtencao: 4 };

const baseProps = {
  summary,
  filter: 'todos' as const,
  onFilter: vi.fn(),
  search: '',
  onSearch: vi.fn(),
  sort: 'atencao' as const,
  onSort: vi.fn(),
};

describe('HealthFilterBar', () => {
  it('renders chips with counts', () => {
    render(<HealthFilterBar {...baseProps} />);
    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy(); // total
    expect(screen.getByText('Atenção')).toBeTruthy();
  });

  it('calls onFilter when a chip is clicked', () => {
    const onFilter = vi.fn();
    render(<HealthFilterBar {...baseProps} onFilter={onFilter} />);
    fireEvent.click(screen.getByText('Saudáveis'));
    expect(onFilter).toHaveBeenCalledWith('saudaveis');
  });

  it('calls onSearch when typing', () => {
    const onSearch = vi.fn();
    render(<HealthFilterBar {...baseProps} onSearch={onSearch} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente…'), { target: { value: 'ana' } });
    expect(onSearch).toHaveBeenCalledWith('ana');
  });

  it('calls onSort when the select changes', () => {
    const onSort = vi.fn();
    render(<HealthFilterBar {...baseProps} onSort={onSort} />);
    fireEvent.change(screen.getByLabelText('Ordenar'), { target: { value: 'seguidores' } });
    expect(onSort).toHaveBeenCalledWith('seguidores');
  });
});
