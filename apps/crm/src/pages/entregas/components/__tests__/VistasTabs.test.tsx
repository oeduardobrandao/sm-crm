import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VistasTabs } from '../VistasTabs';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

// Radix menus open on real pointer events jsdom can't fake — render inline instead,
// same approach as WorkflowCard.badge.test.tsx.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const CONTA = 'conta-test';
const KEY = `entregas_saved_views_${CONTA}`;

const seed = (views: { name: string; query: string }[]) =>
  localStorage.setItem(KEY, JSON.stringify(views));
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]');

describe('VistasTabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders Padrão + saved vistas as tabs and applies on click', () => {
    seed([{ name: 'Posts atrasados', query: 'mode=publicacoes&prazo=atrasado' }]);
    const onApply = vi.fn();
    render(<VistasTabs contaId={CONTA} currentQuery="" onApply={onApply} />);

    expect(screen.getByText('Padrão')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Posts atrasados'));
    expect(onApply).toHaveBeenCalledWith('mode=publicacoes&prazo=atrasado');
  });

  it('Padrão applies the empty query (reset)', () => {
    seed([{ name: 'X', query: 'view=list' }]);
    const onApply = vi.fn();
    render(<VistasTabs contaId={CONTA} currentQuery="view=list" onApply={onApply} />);

    fireEvent.click(screen.getByText('Padrão'));
    expect(onApply).toHaveBeenCalledWith('');
  });

  it('marks the vista matching the mount query as active (shared URL case)', () => {
    seed([{ name: 'Compartilhada', query: 'view=list&mode=publicacoes' }]);
    render(
      <VistasTabs contaId={CONTA} currentQuery="view=list&mode=publicacoes" onApply={vi.fn()} />,
    );
    expect(screen.getByText('Compartilhada').closest('.vista-tab')).toHaveClass(
      'vista-tab--active',
    );
  });

  it('saves a new vista from the + Nova vista popover', () => {
    render(<VistasTabs contaId={CONTA} currentQuery="mode=publicacoes" onApply={vi.fn()} />);

    fireEvent.click(screen.getByText('Nova vista'));
    fireEvent.change(screen.getByPlaceholderText('Nome da vista'), {
      target: { value: 'Minha vista' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(stored()).toEqual([{ name: 'Minha vista', query: 'mode=publicacoes' }]);
    expect(screen.getByText('Minha vista').closest('.vista-tab')).toHaveClass('vista-tab--active');
  });

  it('shows the modified dot when the active vista diverges from the screen', () => {
    seed([{ name: 'Viva', query: 'view=list' }]);
    const { rerender } = render(
      <VistasTabs contaId={CONTA} currentQuery="view=list" onApply={vi.fn()} />,
    );
    expect(document.querySelector('.vista-tab-dot')).toBeNull();

    // The user tweaked a filter → currentQuery changes while Viva stays applied.
    rerender(<VistasTabs contaId={CONTA} currentQuery="view=list&prazo=hoje" onApply={vi.fn()} />);
    expect(document.querySelector('.vista-tab-dot')).not.toBeNull();
  });

  it('updates a vista with the current state via the ⋯ menu', () => {
    seed([{ name: 'Viva', query: 'view=list' }]);
    render(<VistasTabs contaId={CONTA} currentQuery="view=list&prazo=hoje" onApply={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Opções da vista Viva'));
    fireEvent.click(screen.getByText('Atualizar com estado atual'));

    expect(stored()).toEqual([{ name: 'Viva', query: 'view=list&prazo=hoje' }]);
  });

  it('renames inline via the ⋯ menu', () => {
    seed([{ name: 'Antiga', query: 'view=list' }]);
    render(<VistasTabs contaId={CONTA} currentQuery="" onApply={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Opções da vista Antiga'));
    fireEvent.click(screen.getByText('Renomear'));
    const input = screen.getByDisplayValue('Antiga');
    fireEvent.change(input, { target: { value: 'Nova' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(stored()).toEqual([{ name: 'Nova', query: 'view=list' }]);
    expect(screen.getByText('Nova')).toBeInTheDocument();
  });

  it('deletes a vista via the ⋯ menu', () => {
    seed([{ name: 'Velha', query: 'view=chart' }]);
    render(<VistasTabs contaId={CONTA} currentQuery="" onApply={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Opções da vista Velha'));
    fireEvent.click(screen.getByText('Excluir'));

    expect(stored()).toEqual([]);
    expect(screen.queryByText('Velha')).toBeNull();
  });

  it('recovers from corrupted storage', () => {
    localStorage.setItem(KEY, '{not json');
    render(<VistasTabs contaId={CONTA} currentQuery="" onApply={vi.fn()} />);
    expect(screen.getByText('Padrão')).toBeInTheDocument();
    expect(screen.getByText('Nova vista')).toBeInTheDocument();
  });
});
