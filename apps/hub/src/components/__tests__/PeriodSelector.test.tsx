import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PeriodSelector } from '../dashboard/PeriodSelector';

describe('PeriodSelector', () => {
  it('renders all period options and highlights the active one', () => {
    render(<PeriodSelector value={60} onChange={vi.fn()} />);

    const btn30 = screen.getByRole('button', { name: '30d' });
    const btn60 = screen.getByRole('button', { name: '60d' });
    const btn90 = screen.getByRole('button', { name: '90d' });

    expect(btn30).not.toHaveAttribute('data-active', 'true');
    expect(btn60).toHaveAttribute('data-active', 'true');
    expect(btn90).not.toHaveAttribute('data-active', 'true');
  });

  it('calls onChange with the selected period', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={30} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '90d' }));
    expect(onChange).toHaveBeenCalledWith(90);
  });

  it('does not call onChange when clicking the already active period', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={30} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
