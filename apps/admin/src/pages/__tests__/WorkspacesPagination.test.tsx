import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspacesPagination } from '../workspaces/WorkspacesPagination';

describe('WorkspacesPagination', () => {
  it('renders nothing for zero results', () => {
    const { container } = render(
      <WorkspacesPagination total={0} pag={1} por={20} onPage={vi.fn()} onPageSize={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the range and hides the nav when there is a single page', () => {
    render(
      <WorkspacesPagination total={7} pag={1} por={20} onPage={vi.fn()} onPageSize={vi.fn()} />,
    );
    expect(screen.getByText('1–7 de 7')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('clamps an out-of-range page for the range and the current marker', () => {
    render(
      <WorkspacesPagination total={25} pag={5} por={20} onPage={vi.fn()} onPageSize={vi.fn()} />,
    );
    expect(screen.getByText('21–25 de 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  });

  it('pages forward and back', () => {
    const onPage = vi.fn();
    render(
      <WorkspacesPagination total={100} pag={2} por={20} onPage={onPage} onPageSize={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(onPage).toHaveBeenCalledWith(1);
  });
});
