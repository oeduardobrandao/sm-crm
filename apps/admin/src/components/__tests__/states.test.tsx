import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { PageHeader } from '../PageHeader';

describe('state components', () => {
  it('EmptyState renders title, description and action', () => {
    render(
      <EmptyState
        title="Nada aqui"
        description="Tente outra coisa."
        action={<button>Limpar</button>}
      />,
    );
    expect(screen.getByText('Nada aqui')).toBeInTheDocument();
    expect(screen.getByText('Tente outra coisa.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
  });

  it('ErrorState shows a generic message and retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('PageHeader renders title, description and actions slot', () => {
    render(
      <PageHeader title="Workspaces" description="143 cadastrados" actions={<span>ação</span>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByText('143 cadastrados')).toBeInTheDocument();
    expect(screen.getByText('ação')).toBeInTheDocument();
  });
});
