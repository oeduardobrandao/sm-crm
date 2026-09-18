import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AutoScheduleBadge } from '../AutoScheduleBadge';

describe('AutoScheduleBadge', () => {
  it('is a button that fires onClick when interactive', () => {
    const onClick = vi.fn();
    render(<AutoScheduleBadge onClick={onClick} needsDate={false} />);
    fireEvent.click(screen.getByRole('button', { name: /agendar/i }));
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
    fireEvent.pointerDown(screen.getByRole('button', { name: /agendar/i }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it('explains in its title that a date is needed first', () => {
    render(<AutoScheduleBadge onClick={vi.fn()} needsDate />);
    expect(screen.getByRole('button', { name: /agendar/i })).toHaveAttribute(
      'title',
      expect.stringMatching(/data/i),
    );
  });

  // Fix H: `title` alone isn't reliably exposed to assistive tech (native tooltips
  // are inconsistent for screen readers, especially via keyboard nav), so the fuller
  // explanation also needs to be the accessible name via aria-label.
  it('exposes the full explanation as aria-label, not just title, on the button', () => {
    render(<AutoScheduleBadge onClick={vi.fn()} needsDate={false} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', button.getAttribute('title'));
    expect(button.getAttribute('aria-label')).toMatch(/clique para agendar/i);
  });

  it('exposes the full explanation as aria-label on the static badge too', () => {
    render(<AutoScheduleBadge needsDate={false} />);
    const badge = screen.getByText(/Agendar/).closest('span');
    expect(badge).toHaveAttribute('aria-label', badge?.getAttribute('title'));
  });
});
