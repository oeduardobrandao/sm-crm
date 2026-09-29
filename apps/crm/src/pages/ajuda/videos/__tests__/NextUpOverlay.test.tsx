import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextUpOverlay } from '../NextUpOverlay';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('NextUpOverlay', () => {
  it('plays the next video after a 5 second countdown', () => {
    const onGo = vi.fn();
    render(<NextUpOverlay title="Equipe" onGo={onGo} onCancel={vi.fn()} />);
    expect(screen.getByText('Próximo: Equipe')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_000));
    expect(onGo).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it('cancel stops the countdown', () => {
    const onCancel = vi.fn();
    render(<NextUpOverlay title="Equipe" onGo={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });

  // The outline variant only sets bg-background, no text colour, so on a dark overlay it
  // inherits text-white and becomes invisible in light mode (white text on a white button).
  it('keeps the outline "Cancelar" button readable in light mode', () => {
    render(<NextUpOverlay title="Equipe" onGo={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass('text-foreground');
  });
});
