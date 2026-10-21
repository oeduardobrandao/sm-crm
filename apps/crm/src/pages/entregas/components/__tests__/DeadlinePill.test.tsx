import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DeadlinePill, setDeadlineDisplayMode } from '../DeadlinePill';

afterEach(() => {
  act(() => setDeadlineDisplayMode('relativo'));
  localStorage.clear();
});

const Y = new Date().getFullYear();

const base = {
  className: 'board-card-deadline',
  tipoPrazo: 'corridos' as const,
};

describe('DeadlinePill', () => {
  it('alterna entre prazo relativo e data de vencimento, em todos os cards juntos', () => {
    render(
      <>
        <DeadlinePill {...base} relativeText="1d atrasado" dueDate={new Date(Y, 8, 30)} estourado />
        <DeadlinePill
          {...base}
          relativeText="3d restantes"
          dueDate={new Date(Y, 9, 4)}
          estourado={false}
        />
      </>,
    );
    expect(screen.getByText('1d atrasado')).toBeInTheDocument();
    expect(screen.getAllByText('corridos')).toHaveLength(2);

    fireEvent.click(screen.getByText('1d atrasado'));

    expect(screen.getByText('Venceu 30 set')).toBeInTheDocument();
    expect(screen.getByText('Vence 4 out')).toBeInTheDocument();
    expect(screen.queryByText('corridos')).not.toBeInTheDocument();
    expect(localStorage.getItem('entregas_deadline_display')).toBe('data');

    fireEvent.click(screen.getByText('Vence 4 out'));
    expect(screen.getByText('3d restantes')).toBeInTheDocument();
  });

  it('não propaga o clique para o card', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <DeadlinePill
          {...base}
          relativeText="2d restantes"
          dueDate={new Date(Y, 9, 3)}
          estourado={false}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('sem data de vencimento a pill é estática', () => {
    render(<DeadlinePill {...base} relativeText="Sem prazo" dueDate={null} estourado={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
  });
});
