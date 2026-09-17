import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AutoScheduleBadge } from '../AutoScheduleBadge';

describe('AutoScheduleBadge', () => {
  it('is a button that fires onClick when interactive', () => {
    const onClick = vi.fn();
    render(<AutoScheduleBadge onClick={onClick} needsDate={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Agendar/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a static, non-button badge with no onClick (DragOverlay clone)', () => {
    render(<AutoScheduleBadge needsDate={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Agendar/)).toBeInTheDocument();
  });

  it('stops pointerdown from reaching a dnd-kit drag listener', () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <AutoScheduleBadge onClick={onClick} needsDate={false} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: /Agendar/ }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it('explains in its title that a date is needed first', () => {
    render(<AutoScheduleBadge onClick={vi.fn()} needsDate />);
    expect(screen.getByRole('button', { name: /Agendar/ })).toHaveAttribute(
      'title',
      expect.stringMatching(/data/i),
    );
  });
});
