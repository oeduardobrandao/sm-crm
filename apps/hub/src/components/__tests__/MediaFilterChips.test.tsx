import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaFilterChips } from '../MediaFilterChips';

describe('MediaFilterChips', () => {
  it('renders the three chips with counts, marks the active one and reports clicks', () => {
    const onChange = vi.fn();
    render(
      <MediaFilterChips
        value="all"
        counts={{ all: 5, withMedia: 3, withoutMedia: 2 }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Filtrar por mídia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos (5)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Com mídia (3)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Sem mídia (2)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sem mídia (2)' }));
    expect(onChange).toHaveBeenCalledWith('without');
    fireEvent.click(screen.getByRole('button', { name: 'Com mídia (3)' }));
    expect(onChange).toHaveBeenCalledWith('with');
    fireEvent.click(screen.getByRole('button', { name: 'Todos (5)' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('marks the selected chip and keeps a zero-count chip enabled', () => {
    render(
      <MediaFilterChips
        value="with"
        counts={{ all: 2, withMedia: 2, withoutMedia: 0 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Com mídia (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sem mídia (0)' })).toBeEnabled();
  });
});
