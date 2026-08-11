import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import * as ReactModule from 'react';
import { HealthFilterBar } from '../HealthFilterBar';

// Radix Select has no plain DOM <select> to fire a `change` event on, so tests
// drive real user interaction; this replaces it with a static, portal-free
// stand-in whose items are always-rendered buttons, matching the pattern
// already used in ClientesPage.test.tsx.
vi.mock('@/components/ui/select', () => {
  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  const SelectTrigger = ReactModule.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >(({ children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  ));

  function SelectValue() {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value ?? ''}</span>;
  }

  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

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

  it('calls onSort when a sort option is picked', () => {
    const onSort = vi.fn();
    render(<HealthFilterBar {...baseProps} onSort={onSort} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mais seguidores' }));
    expect(onSort).toHaveBeenCalledWith('seguidores');
  });
});
